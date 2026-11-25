import { Repository, Conflict } from "./repository";
import { safeText } from "./sanitize";
import {
  type ServiceInput,
  type OperatorInput,
  type SettingsInput,
  type IntegrationInput,
  type Monitor,
  type Knowledge,
  type Integration,
} from "./contracts";
import type { Env } from "./types";

export const MAX_SERVICES = 20;
export const MAX_SCOPES = 50;

export class Operations extends Repository {
  async scopes() {
    return (
      await this.db
        .prepare(
          `SELECT e.scope,e.name,e.mode,a.id AS application_id,a.name AS application_name FROM environments e JOIN applications a ON a.id=e.application_id WHERE a.workspace_id='default' ORDER BY e.mode,e.scope`,
        )
        .all()
    ).results;
  }
  async authorizeScope() {
    return !!(await this.db
      .prepare(
        `SELECT scope FROM environments e JOIN applications a ON a.id=e.application_id WHERE e.scope=? AND a.workspace_id='default'`,
      )
      .bind(this.scope)
      .first());
  }
  async createScope(
    input: {
      applicationId: string;
      applicationName: string;
      environment: string;
      mode: string;
    },
    actor: string,
  ) {
    const scope = `${input.applicationId}/${input.environment}`;
    // Bound the number of environments so scheduled maintenance stays within limits.
    const count = await this.db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM environments e JOIN applications a ON a.id=e.application_id WHERE a.workspace_id='default') AS total,EXISTS(SELECT 1 FROM environments WHERE scope=?) AS present",
      )
      .bind(scope)
      .first<{ total: number; present: number }>();
    if (!count?.present && (count?.total ?? 0) >= MAX_SCOPES)
      throw new Conflict(
        `The workspace already has the maximum of ${MAX_SCOPES} environments`,
      );
    await this.db.batch([
      this.db
        .prepare(
          "INSERT OR IGNORE INTO applications(id,workspace_id,name,slug) VALUES(?,'default',?,?)",
        )
        .bind(
          input.applicationId,
          safeText(input.applicationName, 100),
          input.applicationId,
        ),
      this.db
        .prepare("INSERT OR IGNORE INTO environments VALUES(?,?,?,?)")
        .bind(scope, input.applicationId, input.environment, input.mode),
      this.db
        .prepare("INSERT OR IGNORE INTO settings(scope) VALUES(?)")
        .bind(scope),
    ]);
    await this.audit(actor, "environment.register", "ok");
    return { scope };
  }
  async services() {
    // Three bounded queries for the whole scope instead of two per service.
    const [rows, sampleRows, edgeRows] = await Promise.all([
      this.stmt(
        `SELECT s.id,s.name,m.* FROM services s JOIN monitors m ON m.scope=s.scope AND m.service_id=s.id WHERE s.scope=? ORDER BY s.name`,
      ).all<Monitor & { id: string; name: string }>(),
      this.stmt(
        `SELECT service_id,observedAt,status,latencyMs,recorded_at FROM (SELECT service_id,observed_at AS observedAt,status,latency_ms AS latencyMs,recorded_at,ROW_NUMBER() OVER (PARTITION BY service_id ORDER BY recorded_at DESC,rowid DESC) AS n FROM health_checks WHERE scope=?) WHERE n<=20 ORDER BY service_id,n`,
      ).all<{
        service_id: string;
        observedAt: string;
        status: string;
        latencyMs: number;
        recorded_at: string;
      }>(),
      this.stmt(
        "SELECT service_id,depends_on FROM service_dependencies WHERE scope=?",
      ).all<{ service_id: string; depends_on: string }>(),
    ]);
    const samplesBy = new Map<string, typeof sampleRows.results>();
    for (const { service_id, ...sample } of sampleRows.results)
      samplesBy.set(service_id, [
        ...(samplesBy.get(service_id) ?? []),
        { service_id, ...sample },
      ]);
    return rows.results.map((service) => {
      const samples = (samplesBy.get(service.id) ?? []).map(
        ({ service_id: _, ...sample }) => sample,
      );
      const recent = samples
          .filter(
            (s) =>
              Date.now() - Date.parse(s.recorded_at) <
              Math.min(
                86400000,
                service.interval_seconds * service.minimum_samples * 2000,
              ),
          )
          .slice(0, service.minimum_samples),
        valid = recent.filter((s) => s.status !== "unknown");
      const stale =
        !samples[0]?.recorded_at ||
        Date.now() - Date.parse(samples[0].recorded_at) >
          service.interval_seconds * 2000;
      const health =
        stale || valid.length < service.minimum_samples
          ? "unknown"
          : valid.filter((s) => s.status === "unhealthy").length >=
              service.failure_threshold
            ? "unhealthy"
            : "healthy";
      const dependencies = edgeRows.results
        .filter((e) => e.service_id === service.id)
        .map((e) => e.depends_on);
      return {
        ...service,
        health,
        stale,
        samples: samples.reverse(),
        dependencies,
      };
    });
  }
  async saveService(input: ServiceInput, actor: string) {
    if (input.dependencies.includes(input.id))
      throw new Conflict("A service cannot depend on itself");
    // Validate references and cycles in this scope before replacing edges.
    const edges = (
      await this.stmt(
        "SELECT service_id,depends_on FROM service_dependencies WHERE scope=?",
      ).all<{ service_id: string; depends_on: string }>()
    ).results.filter((e) => e.service_id !== input.id);
    for (const dep of input.dependencies) {
      if (
        !(await this.stmt(
          "SELECT id FROM services WHERE scope=? AND id=?",
          dep,
        ).first())
      )
        throw new Conflict("Dependency is outside this scope");
      edges.push({ service_id: input.id, depends_on: dep });
    }
    const visit = (id: string, path: Set<string>): boolean => {
      if (path.has(id)) return true;
      const next = new Set(path).add(id);
      return edges
        .filter((e) => e.service_id === id)
        .some((e) => visit(e.depends_on, next));
    };
    if (visit(input.id, new Set())) throw new Conflict("Dependency cycle");
    const existing = await this.stmt(
      "SELECT (SELECT COUNT(*) FROM services WHERE scope=?1) AS total,EXISTS(SELECT 1 FROM services WHERE scope=?1 AND id=?2) AS present",
      input.id,
    ).first<{ total: number; present: number }>();
    if (!existing?.present && (existing?.total ?? 0) >= MAX_SERVICES)
      throw new Conflict(
        `This environment already has the maximum of ${MAX_SERVICES} services`,
      );
    await this.db.batch([
      this.stmt(
        `INSERT INTO services(scope,id,name,kind) SELECT ?1,?2,?3,'synthetic' WHERE (SELECT COUNT(*) FROM services WHERE scope=?1)<${MAX_SERVICES} OR EXISTS(SELECT 1 FROM services WHERE scope=?1 AND id=?2) ON CONFLICT(scope,id) DO UPDATE SET name=excluded.name`,
        input.id,
        safeText(input.name, 100),
      ),
      this.stmt(
        `INSERT INTO monitors(scope,service_id,kind,target_url,enabled,interval_seconds,slow_ms,minimum_samples,failure_threshold,expected_status) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,service_id) DO UPDATE SET kind=excluded.kind,target_url=excluded.target_url,enabled=excluded.enabled,interval_seconds=excluded.interval_seconds,slow_ms=excluded.slow_ms,minimum_samples=excluded.minimum_samples,failure_threshold=excluded.failure_threshold,expected_status=excluded.expected_status`,
        input.id,
        input.kind,
        input.targetUrl ?? null,
        Number(input.enabled),
        input.intervalSeconds,
        input.slowMs,
        input.minimumSamples,
        input.failureThreshold,
        input.expectedStatus,
      ),
      this.stmt(
        "DELETE FROM service_dependencies WHERE scope=? AND service_id=?",
        input.id,
      ),
      ...input.dependencies.map((dep) =>
        this.stmt(
          "INSERT INTO service_dependencies VALUES(?,?,?)",
          input.id,
          dep,
        ),
      ),
    ]);
    await this.audit(actor, "service.configure", "ok");
    return { id: input.id };
  }
  async events(id: string) {
    return (
      await this.stmt(
        "SELECT id,action,payload,actor,created_at,expected_version FROM incident_events WHERE scope=? AND incident_id=? ORDER BY created_at",
        id,
      ).all()
    ).results;
  }
  async operator(id: string, key: string, input: OperatorInput, actor: string) {
    const payload = JSON.stringify({
      ...input,
      note: safeText(input.note, 1000),
      cause: input.cause ? safeText(input.cause, 1000) : undefined,
    });
    const replay = await this.stmt(
      "SELECT payload,incident_id FROM incident_events WHERE scope=? AND id=?",
      key,
    ).first<{ payload: string; incident_id: string }>();
    if (replay) {
      if (replay.payload !== payload || replay.incident_id !== id)
        throw new Conflict("Idempotency key conflict");
      return this.incident(id);
    }
    const detail = await this.incident(id);
    if (!detail) return null;
    if (detail.incident.version !== input.expectedVersion)
      throw new Conflict("Incident version changed; refresh before acting");
    const status = detail.incident.status;
    if (input.action === "retry") {
      if (
        ["resolved", "dismissed"].includes(status) ||
        !detail.run ||
        !["partial", "failed", "cancelled"].includes(detail.run.status) ||
        detail.run.attempt >= 5
      )
        throw new Conflict(
          "Only partial, failed or cancelled investigations can be retried, up to five attempts",
        );
      const now = new Date().toISOString();
      // Every statement re-checks the expected incident version, which only the final
      // statement bumps. A concurrent duplicate (same key, same version) therefore
      // inserts no event and changes nothing, instead of re-applying the retry.
      const guard = `EXISTS(SELECT 1 FROM incidents WHERE scope=?1 AND id=?2 AND version=?3) AND EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?4 AND incident_id=?2)`;
      const results = await this.db.batch([
        this.stmt(
          `INSERT OR IGNORE INTO incident_events(scope,id,incident_id,action,payload,actor,created_at,expected_version) SELECT ?,?,?,'retry',?,?,?,? WHERE EXISTS(SELECT 1 FROM incidents WHERE scope=? AND id=? AND version=?) AND EXISTS(SELECT 1 FROM investigations WHERE scope=? AND incident_id=? AND status IN('partial','failed','cancelled') AND attempt<5)`,
          key,
          id,
          payload,
          actor,
          now,
          input.expectedVersion,
          this.scope,
          id,
          input.expectedVersion,
          this.scope,
          id,
        ),
        // A retry collects fresh evidence; stable per-run evidence IDs would otherwise
        // keep the previous attempt's samples (INSERT OR IGNORE in saveEvidence).
        this.stmt(
          `DELETE FROM evidence WHERE scope=?1 AND investigation_id IN(SELECT id FROM investigations WHERE scope=?1 AND incident_id=?2) AND ${guard}`,
          id,
          input.expectedVersion,
          key,
        ),
        this.stmt(
          `UPDATE investigations SET attempt=attempt+1,workflow_id=id||'-a'||(attempt+1),status='queued',result=NULL,updated_at=?5 WHERE scope=?1 AND incident_id=?2 AND status IN('partial','failed','cancelled') AND attempt<5 AND ${guard}`,
          id,
          input.expectedVersion,
          key,
          now,
        ),
        this.stmt(
          `UPDATE dispatch_outbox SET state='pending',attempts=0,next_attempt_at=?5 WHERE scope=?1 AND id=(SELECT id FROM investigations WHERE scope=?1 AND incident_id=?2) AND ${guard}`,
          id,
          input.expectedVersion,
          key,
          now,
        ),
        this.stmt(
          `UPDATE incidents SET status='investigating',version=version+1 WHERE scope=?1 AND id=?2 AND version=?3 AND EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?4 AND incident_id=?2)`,
          id,
          input.expectedVersion,
          key,
        ),
      ]);
      if (!results[2].meta.changes) {
        const event = await this.stmt(
          "SELECT payload,incident_id FROM incident_events WHERE scope=? AND id=?",
          key,
        ).first<{ payload: string; incident_id: string }>();
        // A concurrent duplicate of the same request is a replay; anything else conflicts.
        if (event?.payload === payload && event.incident_id === id)
          return this.incident(id);
        throw new Conflict("Incident version changed");
      }
      await this.audit(actor, "investigation.retry", "queued");
      return this.incident(id);
    }
    let next = status;
    if (input.action === "verify") {
      if (!["awaiting_operator", "investigating"].includes(status))
        throw new Conflict("Incident cannot enter verification");
      next = "verifying";
    }
    if (input.action === "resolve") {
      if (status !== "verifying")
        throw new Conflict("Request verification before resolving");
      if (!(await this.recovered(id, detail.incident.service_id)))
        throw new Conflict(
          "Three consecutive successful probe runs after verification are required",
        );
      next = "resolved";
    }
    if (input.action === "dismiss") {
      if (["resolved", "dismissed"].includes(status))
        throw new Conflict("Incident is already closed");
      next = "dismissed";
    }
    if (input.action === "cancel") {
      if (["resolved", "dismissed"].includes(status))
        throw new Conflict("Incident is already closed");
      next = "awaiting_operator";
    }
    if (
      input.action === "record-action" &&
      ["resolved", "dismissed"].includes(status)
    )
      throw new Conflict("Incident is closed");
    const now = new Date().toISOString();
    await this.db.batch([
      this.stmt(
        `INSERT INTO incident_events(scope,id,incident_id,action,payload,actor,created_at,expected_version) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM incidents WHERE scope=? AND id=? AND version=?)`,
        key,
        id,
        input.action,
        payload,
        actor,
        now,
        input.expectedVersion,
        this.scope,
        id,
        input.expectedVersion,
      ),
      this.stmt(
        `UPDATE incidents SET status=?2,version=version+1,resolved_at=?3,cause_status=?4,confirmed_cause=?5 WHERE scope=?1 AND id=?6 AND version=?7 AND EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?8)`,
        next,
        next === "resolved" || next === "dismissed" ? now : null,
        next === "resolved" && input.cause ? "confirmed" : "unknown",
        next === "resolved" && input.cause ? safeText(input.cause, 1000) : null,
        id,
        input.expectedVersion,
        key,
      ),
      // Closing or cancelling stops further diagnostic work: a running Workflow sees
      // the cancelled run and skips inference, and an undispatched run is withdrawn.
      // Guarded on this request's event so a stale version changes nothing.
      ...(["cancel", "dismiss", "resolve"].includes(input.action)
        ? [
            this.stmt(
              `UPDATE investigations SET status='cancelled',updated_at=?2 WHERE scope=?1 AND incident_id=?3 AND status NOT IN('completed','partial','failed','cancelled') AND EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?4 AND incident_id=?3)`,
              now,
              id,
              key,
            ),
            this.stmt(
              `UPDATE dispatch_outbox SET state='cancelled' WHERE scope=?1 AND state='pending' AND id IN(SELECT id FROM investigations WHERE scope=?1 AND incident_id=?2 AND status='cancelled') AND EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?3 AND incident_id=?2)`,
              id,
              key,
            ),
          ]
        : []),
      ...(next === "resolved" && input.cause
        ? [
            this.stmt(
              `INSERT OR IGNORE INTO knowledge_entries(scope,id,incident_id,content,confirmed_by,confirmed_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM incident_events WHERE scope=? AND id=?)`,
              crypto.randomUUID(),
              id,
              safeText(input.cause, 1000),
              actor,
              now,
              this.scope,
              key,
            ),
            // Same batch as the lesson, so agents never see a lesson without the revision bump.
            this.stmt(
              `UPDATE settings SET memory_revision=memory_revision+1 WHERE scope=?1 AND EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?2)`,
              key,
            ),
          ]
        : []),
    ]);
    if (
      !(await this.stmt(
        "SELECT id FROM incident_events WHERE scope=? AND id=?",
        key,
      ).first())
    )
      throw new Conflict("Incident version changed");
    await this.audit(actor, `incident.${input.action}`, "ok");
    return this.incident(id);
  }
  async recovered(id: string, serviceId: string) {
    const started = await this.stmt(
      "SELECT created_at FROM incident_events WHERE scope=? AND incident_id=? AND action='verify' ORDER BY created_at DESC LIMIT 1",
      id,
    ).first<{ created_at: string }>();
    if (!started) return false;
    const rows = (
      await this.stmt(
        `SELECT request_key,MIN(CASE WHEN status='healthy' THEN 1 ELSE 0 END) AS healthy,MAX(recorded_at) AS recorded_at FROM health_checks WHERE scope=? AND service_id=? AND recorded_at>? GROUP BY request_key ORDER BY recorded_at DESC LIMIT 3`,
        serviceId,
        started.created_at,
      ).all<{ request_key: string; healthy: number }>()
    ).results;
    return rows.length === 3 && rows.every((r) => r.healthy === 1);
  }
  // An unhealthy probe run during verification sends the incident back to investigation
  // with a new attempt (fresh evidence, new Workflow ID), or to the operator when the
  // five-attempt cap is used up. Only a run recorded after the latest verify request
  // counts, so replaying an older probe run cannot reopen anything. Callers reconcile
  // the outbox afterwards to dispatch the new attempt.
  async verificationFailed(serviceId: string, status: string, key: string) {
    if (status !== "unhealthy") return;
    const incident = await this.stmt(
      "SELECT id FROM incidents WHERE scope=? AND service_id=? AND status='verifying'",
      serviceId,
    ).first<{ id: string }>();
    if (!incident) return;
    const now = new Date().toISOString();
    const event = `verification-failed-${key}`;
    const fresh = `EXISTS(SELECT 1 FROM scenario_runs r WHERE r.scope=?1 AND r.request_key=?3 AND r.service_id=?4 AND r.created_at>(SELECT MAX(created_at) FROM incident_events WHERE scope=?1 AND incident_id=?2 AND action='verify'))`;
    const claimed = `EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?5 AND incident_id=?2) AND EXISTS(SELECT 1 FROM incidents WHERE scope=?1 AND id=?2 AND status='verifying')`;
    const requeue = `attempt<5 AND status NOT IN('queued','running')`;
    const bind = (sql: string, ...extra: (string | number)[]) =>
      this.stmt(sql, incident.id, key, serviceId, event, ...extra);
    await this.db.batch([
      bind(
        `INSERT OR IGNORE INTO incident_events(scope,id,incident_id,action,payload,actor,created_at,expected_version) SELECT ?1,?5,?2,'verification-failed',?7,'system',?6,version FROM incidents WHERE scope=?1 AND id=?2 AND status='verifying' AND ${fresh}`,
        now,
        JSON.stringify({ note: "Verification probe run was unhealthy", probe: key }),
      ),
      bind(
        `DELETE FROM evidence WHERE scope=?1 AND investigation_id IN(SELECT id FROM investigations WHERE scope=?1 AND incident_id=?2 AND ${requeue}) AND ${claimed}`,
      ),
      bind(
        `UPDATE investigations SET attempt=attempt+1,workflow_id=id||'-a'||(attempt+1),status='queued',result=NULL,updated_at=?6 WHERE scope=?1 AND incident_id=?2 AND ${requeue} AND ${claimed}`,
        now,
      ),
      bind(
        `UPDATE dispatch_outbox SET state='pending',attempts=0,next_attempt_at=?6 WHERE scope=?1 AND id IN(SELECT id FROM investigations WHERE scope=?1 AND incident_id=?2 AND status='queued' AND updated_at=?6) AND ${claimed}`,
        now,
      ),
      bind(
        `UPDATE incidents SET status=CASE WHEN EXISTS(SELECT 1 FROM investigations WHERE scope=?1 AND incident_id=?2 AND status IN('queued','running')) THEN 'investigating' ELSE 'awaiting_operator' END,version=version+1 WHERE scope=?1 AND id=?2 AND status='verifying' AND EXISTS(SELECT 1 FROM incident_events WHERE scope=?1 AND id=?5 AND incident_id=?2)`,
      ),
    ]);
  }
  async memory() {
    return (
      await this.stmt(
        "SELECT id,incident_id,content,confirmed_by,confirmed_at,version FROM knowledge_entries WHERE scope=? ORDER BY confirmed_at DESC LIMIT 100",
      ).all<Knowledge>()
    ).results;
  }
  async updateMemory(
    id: string,
    version: number,
    content: string | null,
    actor: string,
  ) {
    const now = new Date().toISOString();
    const statements = [
      this.stmt(
        `UPDATE incidents SET confirmed_cause=?2,cause_status=?3,version=version+1 WHERE scope=?1 AND id=(SELECT incident_id FROM knowledge_entries WHERE scope=?1 AND id=?4 AND version=?5)`,
        content === null ? null : safeText(content, 1000),
        content === null ? "withdrawn" : "confirmed",
        id,
        version,
      ),
      this.stmt(
        `UPDATE settings SET memory_revision=memory_revision+1 WHERE scope=?1 AND EXISTS(SELECT 1 FROM knowledge_entries WHERE scope=?1 AND id=?2 AND version=?3)`,
        id,
        version,
      ),
      content === null
        ? this.stmt(
            "DELETE FROM knowledge_entries WHERE scope=? AND id=? AND version=?",
            id,
            version,
          )
        : this.stmt(
            "UPDATE knowledge_entries SET content=?2,version=version+1,confirmed_by=?3,confirmed_at=?4 WHERE scope=?1 AND id=?5 AND version=?6",
            safeText(content, 1000),
            actor,
            now,
            id,
            version,
          ),
    ];
    const results = await this.db.batch(statements);
    if (!results[2].meta.changes)
      throw new Conflict("Knowledge is unavailable or has changed");
    await this.audit(
      actor,
      content === null ? "knowledge.delete" : "knowledge.correct",
      "ok",
    );
  }
  async integrations() {
    return (
      await this.stmt(
        "SELECT * FROM integrations WHERE scope=? ORDER BY provider",
      ).all<Integration>()
    ).results;
  }
  async saveIntegration(input: IntegrationInput, actor: string) {
    if (
      !(await this.stmt(
        "SELECT id FROM services WHERE scope=? AND id=?",
        input.serviceId,
      ).first())
    )
      throw new Conflict("Service is outside this scope");
    await this.db.batch([
      this.stmt(
        `INSERT INTO integrations(scope,provider,service_id,config,enabled) VALUES(?,?,?,?,?) ON CONFLICT(scope,provider,service_id) DO UPDATE SET config=excluded.config,enabled=excluded.enabled,status='unverified',safe_error=NULL`,
        input.provider,
        input.serviceId,
        JSON.stringify(input.config),
        Number(input.enabled),
      ),
      this.stmt(
        "DELETE FROM telemetry WHERE scope=? AND provider=? AND service_id=?",
        input.provider,
        input.serviceId,
      ),
    ]);
    await this.audit(actor, "integration.configure", "ok");
  }
  async settings() {
    return await this.stmt("SELECT * FROM settings WHERE scope=?").first<{
      daily_ai_limit: number;
      ai_enabled: number;
      input_price: number | null;
      output_price: number | null;
      currency: string;
      price_checked_at: string | null;
      retention_days: number;
    }>();
  }
  async saveSettings(input: SettingsInput, actor: string) {
    await this.stmt(
      // The price date records when prices were last changed, not every settings save.
      "UPDATE settings SET daily_ai_limit=?2,ai_enabled=?3,price_checked_at=CASE WHEN ?4 IS NULL AND ?5 IS NULL THEN NULL WHEN input_price IS ?4 AND output_price IS ?5 THEN price_checked_at ELSE ?6 END,input_price=?4,output_price=?5,retention_days=?7 WHERE scope=?1",
      input.dailyAiLimit,
      Number(input.aiEnabled),
      input.inputPrice,
      input.outputPrice,
      new Date().toISOString(),
      input.retentionDays,
    ).run();
    await this.audit(actor, "settings.configure", "ok");
  }
  async usage(env: Env) {
    const settings = await this.settings();
    const day = new Date().toISOString().slice(0, 10);
    const calls = await this.stmt(
      `SELECT COUNT(*) AS calls,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN mode='remote' AND (input_tokens IS NULL OR output_tokens IS NULL) THEN 1 ELSE 0 END) AS unmetered FROM ai_calls WHERE scope=? AND day=?`,
      day,
    ).first<{
      calls: number;
      input_tokens: number | null;
      output_tokens: number | null;
      completed: number;
      unmetered: number;
    }>();
    const probes = await this.stmt(
      "SELECT COUNT(*) AS probes FROM health_checks WHERE scope=? AND recorded_at>=? AND recorded_at<?",
      `${day}T00:00:00.000Z`,
      `${day}T99`,
    ).first<{ probes: number }>();
    const estimated =
      settings?.input_price != null &&
      settings?.output_price != null &&
      calls?.input_tokens != null &&
      calls.output_tokens != null
        ? (calls.input_tokens * settings.input_price +
            calls.output_tokens * settings.output_price) /
          1e6
        : null;
    return {
      day,
      ...calls,
      ...probes,
      dailyLimit: Math.min(
        settings?.daily_ai_limit ?? 10,
        Number(env.DAILY_AI_LIMIT) || 0,
      ),
      aiEnabled: !!settings?.ai_enabled,
      estimatedModelCost: estimated,
      currency: settings?.currency ?? "USD",
      priceCheckedAt: settings?.price_checked_at,
      exclusions: [
        "Workers, D1, Durable Objects, Workflows and provider charges",
        "Unmetered or failed model requests",
        "Not a provider invoice",
      ],
    };
  }
  // Export bounds are generous but explicit; `truncated` says when a limit was reached.
  async exportScope() {
    const limits = { incidents: 500, knowledge: 1000, telemetry: 1000, events: 5000 };
    const [incidents, knowledge, telemetry, events, settings, services] =
      await Promise.all([
        this.stmt(
          "SELECT * FROM incidents WHERE scope=? ORDER BY opened_at DESC LIMIT ?",
          limits.incidents + 1,
        ).all<{ id: string }>(),
        this.stmt(
          "SELECT id,incident_id,content,confirmed_by,confirmed_at,version FROM knowledge_entries WHERE scope=? ORDER BY confirmed_at DESC LIMIT ?",
          limits.knowledge + 1,
        ).all(),
        this.stmt(
          "SELECT id,service_id,provider,kind,status,summary,observed_at,fetched_at,expires_at FROM telemetry WHERE scope=? ORDER BY fetched_at DESC LIMIT ?",
          limits.telemetry + 1,
        ).all(),
        this.stmt(
          "SELECT id,incident_id,action,payload,actor,created_at,expected_version FROM incident_events WHERE scope=? ORDER BY created_at DESC LIMIT ?",
          limits.events + 1,
        ).all<{ incident_id: string }>(),
        this.stmt(
          "SELECT daily_ai_limit,ai_enabled,input_price,output_price,currency,price_checked_at,retention_days FROM settings WHERE scope=?",
        ).first(),
        this.services(),
      ]);
    const take = <T,>(rows: T[], limit: number) => rows.slice(0, limit);
    const shownIncidents = take(incidents.results, limits.incidents);
    const details = await Promise.all(
      shownIncidents.map((i) => this.incident(i.id)),
    );
    const shownEvents = take(events.results, limits.events);
    return {
      settings,
      services,
      incidents: details.filter(Boolean).map((detail) => ({
        ...detail,
        events: shownEvents.filter((e) => e.incident_id === detail!.incident.id),
      })),
      knowledge: take(knowledge.results, limits.knowledge),
      telemetry: take(telemetry.results, limits.telemetry),
      truncated: {
        incidents: incidents.results.length > limits.incidents,
        knowledge: knowledge.results.length > limits.knowledge,
        telemetry: telemetry.results.length > limits.telemetry,
        events: events.results.length > limits.events,
      },
    };
  }
  async notifications() {
    return (
      await this.stmt(
        "SELECT * FROM notifications WHERE scope=? ORDER BY created_at DESC LIMIT 50",
      ).all()
    ).results;
  }
  async telemetry(kind?: string) {
    return (
      await this.stmt(
        `SELECT id,service_id,provider,kind,status,summary,observed_at,fetched_at,expires_at FROM telemetry WHERE scope=?${kind ? " AND kind=?" : ""} ORDER BY fetched_at DESC LIMIT 100`,
        ...(kind ? [kind] : []),
      ).all<import("./contracts").Telemetry>()
    ).results;
  }
  async purge() {
    const settings = await this.settings();
    const cutoff = new Date(
      Date.now() - (settings?.retention_days ?? 30) * 86400000,
    ).toISOString();
    const closedCutoff = new Date(Date.now() - 180 * 86400000).toISOString();
    const now = new Date().toISOString();
    const closed =
      "SELECT id FROM incidents WHERE scope=?1 AND status IN('resolved','dismissed') AND resolved_at<?2";
    await this.db.batch([
      this.stmt(
        "DELETE FROM health_checks WHERE scope=? AND recorded_at<?",
        cutoff,
      ),
      this.stmt(
        "DELETE FROM scenario_runs WHERE scope=? AND created_at<?",
        cutoff,
      ),
      this.stmt("DELETE FROM evidence WHERE scope=? AND fetched_at<?", cutoff),
      this.stmt("DELETE FROM telemetry WHERE scope=? AND expires_at<?", now),
      this.stmt(
        "DELETE FROM audit_logs WHERE scope=? AND created_at<?",
        new Date(Date.now() - 90 * 86400000).toISOString(),
      ),
      this.stmt(
        "DELETE FROM ai_calls WHERE scope=? AND day<?",
        new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
      ),
      this.stmt(
        "DELETE FROM scheduler_leases WHERE scope=? AND created_at<?",
        new Date(Date.now() - 86400000).toISOString(),
      ),
      this.stmt(
        `UPDATE settings SET memory_revision=memory_revision+1 WHERE scope=?1 AND EXISTS(SELECT 1 FROM knowledge_entries WHERE scope=?1 AND incident_id IN(${closed}))`,
        closedCutoff,
      ),
      this.stmt(
        `DELETE FROM evidence WHERE scope=?1 AND investigation_id IN(SELECT id FROM investigations WHERE scope=?1 AND incident_id IN(${closed}))`,
        closedCutoff,
      ),
      this.stmt(
        `DELETE FROM dispatch_outbox WHERE scope=?1 AND id IN(SELECT id FROM investigations WHERE scope=?1 AND incident_id IN(${closed}))`,
        closedCutoff,
      ),
      this.stmt(
        `DELETE FROM investigations WHERE scope=?1 AND incident_id IN(${closed})`,
        closedCutoff,
      ),
      this.stmt(
        `DELETE FROM knowledge_entries WHERE scope=?1 AND incident_id IN(${closed})`,
        closedCutoff,
      ),
      this.stmt(
        `DELETE FROM notifications WHERE scope=?1 AND incident_id IN(${closed})`,
        closedCutoff,
      ),
      this.stmt(
        `DELETE FROM incident_events WHERE scope=?1 AND incident_id IN(${closed})`,
        closedCutoff,
      ),
      this.stmt(
        `DELETE FROM incidents WHERE scope=?1 AND id IN(${closed})`,
        closedCutoff,
      ),
    ]);
  }
}
