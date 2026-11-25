import { detect, type Scenario, type Sample } from "./domain";
import { samplesFor } from "./fixtures";
import type { Evidence, Incident, Investigation } from "./types";

export class Conflict extends Error {}
export class Repository {
  constructor(
    readonly db: D1Database,
    readonly scope: string,
  ) {}
  stmt(sql: string, ...values: (string | number | null)[]) {
    return this.db.prepare(sql).bind(this.scope, ...values);
  }
  async overview() {
    const [services, incidents, latest] = await Promise.all([
      this.stmt("SELECT id, name, kind FROM services WHERE scope = ?").all(),
      this.stmt(
        "SELECT * FROM incidents WHERE scope = ? ORDER BY opened_at DESC LIMIT 20",
      ).all<Incident>(),
      this.stmt(
        "SELECT request_key, scenario, created_at FROM scenario_runs WHERE scope = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      ).first<{
        request_key: string;
        scenario: Scenario;
        created_at: string;
      }>(),
    ]);
    const samples = latest
      ? (
          await this.stmt(
            "SELECT observed_at AS observedAt, status, latency_ms AS latencyMs FROM health_checks WHERE scope = ? AND request_key = ? ORDER BY observed_at LIMIT 100",
            latest.request_key,
          ).all<Sample>()
        ).results
      : [];
    return {
      services: services.results,
      incidents: incidents.results,
      latest: latest
        ? { scenario: latest.scenario, created_at: latest.created_at }
        : null,
      samples,
      health: detect(samples),
    };
  }
  async scenario(
    scenario: Scenario,
    key: string,
    actor: string,
    serviceId = "demo-api",
  ) {
    return this.recordSamples(
      serviceId,
      scenario,
      samplesFor(scenario),
      key,
      actor,
    );
  }
  async recordSamples(
    serviceId: string,
    scenario: string,
    samples: Sample[],
    key: string,
    actor: string,
  ) {
    const now = new Date().toISOString();
    const monitor = await this.stmt(
      "SELECT minimum_samples,failure_threshold,interval_seconds FROM monitors WHERE scope=? AND service_id=?",
      serviceId,
    ).first<{
      minimum_samples: number;
      failure_threshold: number;
      interval_seconds: number;
    }>();
    if (!monitor) throw new Conflict("Service is unavailable in this scope");
    const recent =
      scenario === "http"
        ? (
            await this.stmt(
              "SELECT observed_at AS observedAt,status,latency_ms AS latencyMs FROM health_checks WHERE scope=? AND service_id=? AND recorded_at>=? ORDER BY recorded_at DESC,rowid DESC LIMIT 20",
              serviceId,
              new Date(
                Date.now() -
                  Math.min(
                    86400000,
                    monitor.interval_seconds * monitor.minimum_samples * 2000,
                  ),
              ).toISOString(),
            ).all<Sample>()
          ).results.reverse()
        : [];
    const window = [...recent, ...samples].slice(-monitor.minimum_samples);
    const valid = window.filter((s) => s.status !== "unknown");
    const status =
      valid.length < monitor.minimum_samples
        ? "unknown"
        : valid.filter((s) => s.status === "unhealthy").length >=
            monitor.failure_threshold
          ? "unhealthy"
          : "healthy";
    const id = crypto.randomUUID();
    const statements = [
      this.stmt(
        "INSERT OR IGNORE INTO scenario_runs(scope,request_key,scenario,created_at,service_id) VALUES (?,?,?,?,?)",
        key,
        scenario,
        now,
        serviceId,
      ),
    ];
    for (const sample of samples)
      statements.push(
        this.stmt(
          `INSERT OR IGNORE INTO health_checks(scope,request_key,service_id,observed_at,status,latency_ms,recorded_at,http_status,category)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM scenario_runs WHERE scope=? AND request_key=? AND scenario=? AND service_id=?)`,
          key,
          serviceId,
          sample.observedAt,
          sample.status,
          sample.latencyMs,
          now,
          "httpStatus" in sample ? (sample.httpStatus as number) : null,
          "category" in sample ? (sample.category as string) : null,
          this.scope,
          key,
          scenario,
          serviceId,
        ),
      );
    if (status === "unhealthy") {
      statements.push(
        this.stmt(
          `INSERT OR IGNORE INTO incidents(scope,id,service_id,scenario,opened_at,recurrence_of)
        SELECT ?,?,?,?, ?, (SELECT id FROM incidents WHERE scope=? AND service_id=? AND status='resolved' ORDER BY resolved_at DESC LIMIT 1)
        WHERE EXISTS(SELECT 1 FROM scenario_runs WHERE scope=? AND request_key=? AND scenario=? AND service_id=? AND incident_id IS NULL)`,
          id,
          serviceId,
          scenario,
          now,
          this.scope,
          serviceId,
          this.scope,
          key,
          scenario,
          serviceId,
        ),
      );
      statements.push(
        this.stmt(
          `UPDATE scenario_runs SET incident_id=(SELECT id FROM incidents WHERE scope=?1 AND service_id=?2 AND status NOT IN('resolved','dismissed')) WHERE scope=?1 AND request_key=?3 AND scenario=?4 AND service_id=?2 AND incident_id IS NULL`,
          serviceId,
          key,
          scenario,
        ),
      );
      statements.push(
        this.stmt(
          `INSERT OR IGNORE INTO investigations(scope,id,incident_id,updated_at,workflow_id) SELECT scope,id,id,?2,id FROM incidents WHERE scope=?1 AND service_id=?3 AND status NOT IN('resolved','dismissed')`,
          now,
          serviceId,
        ),
      );
      statements.push(
        this.stmt(
          `INSERT OR IGNORE INTO dispatch_outbox(scope,id,next_attempt_at) SELECT scope,id,?2 FROM investigations WHERE scope=?1 AND status='queued'`,
          now,
        ),
      );
      statements.push(
        this.stmt(
          `INSERT OR IGNORE INTO notifications(scope,id,incident_id,title,created_at) SELECT scope,id,id,'Service health anomaly detected',opened_at FROM incidents WHERE scope=? AND service_id=? AND status NOT IN('resolved','dismissed')`,
          serviceId,
        ),
      );
    }
    await this.db.batch(statements);
    const saved = await this.stmt(
      "SELECT scenario,service_id,incident_id FROM scenario_runs WHERE scope=? AND request_key=?",
      key,
    ).first<{
      scenario: string;
      service_id: string;
      incident_id: string | null;
    }>();
    if (saved?.scenario !== scenario || saved.service_id !== serviceId)
      throw new Conflict("Idempotency key was used for another request");
    await this.audit(actor, "probe.record", status);
    const incident = saved.incident_id
      ? await this.stmt(
          "SELECT * FROM incidents WHERE scope=? AND id=?",
          saved.incident_id,
        ).first<Incident>()
      : null;
    return { health: status, incident };
  }
  async incident(id: string) {
    const incident = await this.stmt(
      "SELECT * FROM incidents WHERE scope = ? AND id = ?",
      id,
    ).first<Incident>();
    if (!incident) return null;
    const run = await this.stmt(
      "SELECT * FROM investigations WHERE scope = ? AND incident_id = ?",
      id,
    ).first<Investigation>();
    const evidence = run
      ? (
          await this.stmt(
            "SELECT * FROM evidence WHERE scope = ? AND investigation_id = ? ORDER BY id",
            run.id,
          ).all<Evidence>()
        ).results
      : [];
    return { incident, run, evidence };
  }
  async saveEvidence(id: string, expectedAttempt = 1) {
    const detail = await this.incident(id);
    if (!detail?.run) throw new Error("Unavailable scoped incident");
    if (
      detail.run.attempt !== expectedAttempt ||
      detail.run.status === "cancelled"
    )
      return detail.evidence;
    const samples = (
      await this.stmt(
        "SELECT observed_at AS observedAt,status,latency_ms AS latencyMs,http_status,category FROM health_checks WHERE scope=? AND service_id=? AND recorded_at<=? ORDER BY recorded_at DESC,rowid DESC LIMIT 20",
        detail.incident.service_id,
        detail.incident.opened_at,
      ).all()
    ).results;
    const now = new Date().toISOString();
    const statements = [
      this.stmt(
        `INSERT OR IGNORE INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `${id}-probe`,
        id,
        detail.incident.scenario === "http" ? "http-probe" : "synthetic-probe",
        JSON.stringify(samples),
        detail.incident.opened_at,
        now,
      ),
      this.stmt(
        `UPDATE investigations SET status='running',updated_at=?2 WHERE scope=?1 AND id=?3 AND status='queued'`,
        now,
        id,
      ),
      this.stmt(
        `UPDATE incidents SET status='investigating',version=version+1 WHERE scope=?1 AND id=?2 AND status='open'`,
        id,
      ),
    ];
    if (detail.incident.scenario !== "http")
      statements.push(
        this.stmt(
          `INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?)`,
          `${id}-deployment`,
          id,
          detail.incident.scenario === "database-slowdown"
            ? "synthetic-database"
            : "synthetic-deployment",
          detail.incident.scenario === "database-slowdown"
            ? "Synthetic database aggregate: connection usage 95%, query duration 2100ms. No recent release change."
            : "Synthetic revision demo-b deployed at 2026-11-24T08:03:00.000Z; temporal correlation only.",
          "2026-11-24T08:03:00.000Z",
          now,
        ),
      );
    else {
      const telemetry = (
        await this.stmt(
          "SELECT * FROM telemetry WHERE scope=? AND service_id=? AND expires_at>? ORDER BY fetched_at DESC LIMIT 5",
          detail.incident.service_id,
          now,
        ).all<{
          id: string;
          provider: string;
          summary: string;
          observed_at: string;
          fetched_at: string;
        }>()
      ).results;
      for (const t of telemetry)
        statements.push(
          this.stmt(
            "INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?)",
            `${id}-${t.id}`,
            id,
            t.provider,
            t.summary,
            t.observed_at,
            t.fetched_at,
          ),
        );
    }
    await this.db.batch(statements);
    return (await this.incident(id))!.evidence;
  }
  async reserveAI(id: string, limit: number) {
    const settings = await this.stmt(
      "SELECT daily_ai_limit,ai_enabled FROM settings WHERE scope=?",
    ).first<{ daily_ai_limit: number; ai_enabled: number }>();
    if (!settings?.ai_enabled || !Number.isInteger(limit) || limit < 1)
      return false;
    const cap = Math.min(limit, 100),
      day = new Date().toISOString().slice(0, 10);
    const result = await this.stmt(
      `INSERT OR IGNORE INTO ai_calls(scope,id,day,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM ai_calls WHERE day=?)<? AND (SELECT COUNT(*) FROM ai_calls WHERE day=? AND scope=?)<?`,
      id,
      day,
      new Date().toISOString(),
      day,
      cap,
      day,
      this.scope,
      settings.daily_ai_limit,
    ).run();
    return result.meta.changes === 1;
  }
  async meterAI(
    id: string,
    mode: string,
    status: string,
    usage?: { prompt_tokens?: number; completion_tokens?: number },
  ) {
    const number = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) && n >= 0
        ? Math.floor(n)
        : null;
    await this.stmt(
      "UPDATE ai_calls SET mode=?2,status=?3,input_tokens=?4,output_tokens=?5 WHERE scope=?1 AND id=?6",
      mode,
      status,
      number(usage?.prompt_tokens),
      number(usage?.completion_tokens),
      id,
    ).run();
  }
  async complete(
    id: string,
    result: unknown,
    status: "completed" | "partial",
    expectedAttempt = 1,
  ) {
    await this.db.batch([
      this.stmt(
        `UPDATE investigations SET result = ?2, status = ?3, updated_at = ?4 WHERE scope = ?1 AND id = ?5 AND result IS NULL AND status<>'cancelled' AND attempt=?6`,
        JSON.stringify(result),
        status,
        new Date().toISOString(),
        id,
        expectedAttempt,
      ),
      this.stmt(
        `UPDATE incidents SET status = 'awaiting_operator', version = version + 1 WHERE scope = ?1 AND id = ?2 AND status IN ('open','investigating') AND EXISTS(SELECT 1 FROM investigations WHERE scope=?1 AND incident_id=?2 AND status<>'cancelled' AND attempt=?3)`,
        id,
        expectedAttempt,
      ),
    ]);
  }
  async audit(actor: string, action: string, outcome: string) {
    await this.stmt(
      "INSERT INTO audit_logs(scope,actor,action,outcome,created_at) VALUES (?,?,?,?,?)",
      actor,
      action,
      outcome,
      new Date().toISOString(),
    ).run();
  }
}
