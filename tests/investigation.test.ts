import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Operations } from "../src/operations";
import { summarize } from "../src/inference";
import { InvestigationWorkflow } from "../src/workflow";
import { FOLLOW_UPS } from "../src/domain";
import { serviceSchema, settingsSchema } from "../src/contracts";
import type { Env } from "../src/types";

const pause = () => new Promise((r) => setTimeout(r, 3));
const HOUR = 3600_000;

// Investigation workflow steps 4, 5, 6 and 8 of INCIDENT_WORKFLOW.md: scoped history
// retrieval, the operator wait timeout and the recovery comparison with a baseline.
describe("investigation history, operator wait and recovery baseline", () => {
  let mf: Miniflare, repo: Operations, other: Operations;
  const env = {
    MODE: "development",
    AI_MODE: "fixture",
    DAILY_AI_LIMIT: "100",
  } as Env;
  beforeAll(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default {fetch(){return new Response("ok")}}',
        d1Databases: ["DB"],
        compatibilityDate: "2026-11-24",
      }),
    );
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    for (const file of [
      "0001_foundation.sql",
      "0002_operations.sql",
      "0003_conversation_activity.sql",
      "0004_investigation_history.sql",
      "0005_recommendations_delivery.sql",
    ])
      await db.exec(
        (
          await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8")
        ).replace(/\n/g, " "),
      );
    other = new Operations(db, "synthetic/demo");
    await other.createScope(
      { applicationId: "histapp", applicationName: "History app", environment: "demo", mode: "demo" },
      "tester",
    );
    repo = new Operations(db, "histapp/demo");
    for (const target of [repo, other])
      for (const id of ["api", "db"])
        await target.saveService(
          serviceSchema.parse({ id, name: id.toUpperCase(), kind: "synthetic" }),
          "tester",
        );
  }, 30_000);
  afterAll(async () => await mf?.dispose());
  const count = async (target: Operations, sql: string, ...args: string[]) =>
    (await target.stmt(sql, ...args).first<{ n: number }>())!.n;

  const act = async (
    target: Operations,
    id: string,
    key: string,
    action: string,
    extra: Record<string, string> = {},
  ) => {
    const { incident } = (await target.incident(id))!;
    return target.operator(
      id,
      key,
      { action, expectedVersion: incident.version, note: `${action} by test`, ...extra } as never,
      "tester",
    );
  };
  const healthyRuns = async (target: Operations, prefix: string, service = "api", n = 3) => {
    for (let i = 0; i < n; i++) {
      await pause();
      await target.scenario("healthy", `${prefix}-${i}`, "tester", service);
    }
  };
  // Detect, investigate, verify, recover and resolve; returns the incident ID.
  const resolveIncident = async (
    target: Operations,
    prefix: string,
    scenario: "deployment-regression" | "database-slowdown",
    service: string,
    cause?: string,
  ) => {
    await healthyRuns(target, `${prefix}-baseline`, service);
    await pause();
    const id = (await target.scenario(scenario, `${prefix}-detect`, "tester", service)).incident!.id;
    await target.saveEvidence(id);
    await target.complete(id, { status: "completed" }, "completed");
    await act(target, id, `${prefix}-verify`, "verify");
    await healthyRuns(target, `${prefix}-recovery`, service);
    await act(target, id, `${prefix}-resolve`, "resolve", cause ? { cause } : {});
    return id;
  };

  describe("prior incidents and confirmed lessons", () => {
    let first: string, dismissed: string;
    it("adds earlier incidents of the service to the evidence, confirmed lessons first", async () => {
      first = await resolveIncident(
        repo,
        "hist-1",
        "deployment-regression",
        "api",
        "Revision demo-b exhausted the connection pool; rolled back.",
      );
      await pause();
      dismissed = (await repo.scenario("deployment-regression", "hist-2-detect", "tester", "api")).incident!.id;
      await repo.complete(
        dismissed,
        { status: "completed", finding: { summary: "Model guessed a cache stampede." } },
        "completed",
      );
      await act(repo, dismissed, "hist-2-dismiss", "dismiss");
      await pause();
      const current = (await repo.scenario("deployment-regression", "hist-3-detect", "tester", "api")).incident!.id;
      const evidence = await repo.saveEvidence(current);
      const history = evidence
        .filter((e) => e.provider === "incident-history")
        .map((e) => JSON.parse(e.summary) as Record<string, unknown>);
      expect(history.map((h) => h.incidentId)).toEqual(
        expect.arrayContaining([first, dismissed]),
      );
      const confirmed = history.find((h) => h.incidentId === first)!;
      expect(confirmed.confirmation).toBe("operator-confirmed");
      expect(confirmed.lesson).toContain("connection pool");
      const unconfirmed = history.find((h) => h.incidentId === dismissed)!;
      expect(unconfirmed.confirmation).toBe("unconfirmed");
      expect(unconfirmed.lesson).toBeNull();
      expect(unconfirmed.priorSummary).toBe("Model guessed a cache stampede.");
      // Confirmed lessons are ranked ahead of more recent unconfirmed incidents.
      // (Evidence rows come back ordered by ID, so check the ranking at the source.)
      const ranked = await repo.incidentHistory("api", current, new Date().toISOString());
      expect(ranked.map((h) => h.incidentId)).toEqual([first, dismissed]);
      expect((await repo.incidentHistory("api", current, new Date().toISOString(), 1))[0].incidentId).toBe(first);
    });

    it("lets the summary cite a confirmed lesson as a check, not as the cause", async () => {
      const current = (await repo.overview()).incidents.find((i) => i.status === "investigating")!;
      const evidence = (await repo.incident(current.id))!.evidence;
      const result = await summarize(env, repo, `hist-summary-${crypto.randomUUID()}`, evidence);
      expect(result.status).toBe("completed");
      const finding = (result as { finding: { observations: { text: string; evidenceIds: string[] }[]; recommendations: string[]; hypotheses: { confidence: string }[] } }).finding;
      const cited = finding.observations.find((o) => o.text.includes("operator-confirmed lesson"));
      expect(cited?.evidenceIds).toEqual([`${current.id}-history-${first}`]);
      expect(finding.recommendations[0]).toMatch(/previously confirmed cause has recurred/);
      expect(finding.hypotheses.every((h) => h.confidence === "low")).toBe(true);
    });

    it("stops treating a lesson as confirmed once the operator deletes it", async () => {
      const lesson = (await repo.memory()).find((k) => k.incident_id === first)!;
      await repo.updateMemory(lesson.id, lesson.version, null, "tester");
      const current = (await repo.overview()).incidents.find((i) => i.status === "investigating")!;
      const history = await repo.incidentHistory("api", current.id, current.opened_at);
      expect(history.find((h) => h.incidentId === first)?.confirmation).toBe("unconfirmed");
    });

    it("never retrieves another environment's or another service's history", async () => {
      const current = (await repo.overview()).incidents.find((i) => i.status === "investigating")!;
      // Same service ID in another environment, and another service here: both invisible.
      await pause();
      const foreign = (await other.scenario("deployment-regression", "hist-foreign", "tester", "api")).incident!.id;
      await act(other, foreign, "hist-foreign-dismiss", "dismiss");
      expect(
        (await repo.incidentHistory("api", current.id, new Date().toISOString())).some(
          (h) => h.incidentId === foreign,
        ),
      ).toBe(false);
      expect(await repo.incidentHistory("db", current.id, new Date().toISOString())).toEqual([]);
      // Clean up so later tests start without an open "api" incident.
      await act(repo, current.id, "hist-3-dismiss", "dismiss");
    });
  });

  describe("operator wait timeout", () => {
    let id: string;
    it("flags an incident left waiting past the timeout without closing it", async () => {
      await pause();
      id = (await repo.scenario("deployment-regression", "wait-detect", "tester", "api")).incident!.id;
      await repo.saveEvidence(id);
      await repo.complete(id, { status: "completed" }, "completed");
      const before = (await repo.incident(id))!.incident;
      expect(before.status).toBe("awaiting_operator");
      expect(await repo.expireOperatorWaits(Date.now() + 1 * HOUR)).toBe(0);
      expect(await repo.expireOperatorWaits(Date.now() + 25 * HOUR)).toBe(1);
      const after = (await repo.incident(id))!.incident;
      expect(after.status).toBe("awaiting_operator");
      expect(after.version).toBe(before.version);
      const events = await repo.events(id);
      expect(events.filter((e) => e.action === "operator-wait-expired")).toHaveLength(1);
      const notes = (await repo.notifications()) as { incident_id: string; title: string }[];
      expect(notes.filter((n) => n.incident_id === id).map((n) => n.title)).toContain(
        "Incident waiting on an operator for over 24 h",
      );
    });

    it("reminds once per wait and lets the operator act on the unchanged version", async () => {
      expect(await repo.expireOperatorWaits(Date.now() + 50 * HOUR)).toBe(0);
      await act(repo, id, "wait-record", "record-action");
      // New activity starts a new wait at a new version.
      expect(await repo.expireOperatorWaits(Date.now() + 25 * HOUR)).toBe(1);
      expect(
        (await repo.events(id)).filter((e) => e.action === "operator-wait-expired"),
      ).toHaveLength(2);
    });

    it("uses the configured timeout and leaves other environments alone", async () => {
      await repo.saveSettings(
        settingsSchema.parse({
          dailyAiLimit: 10,
          aiEnabled: true,
          inputPrice: null,
          outputPrice: null,
          retentionDays: 30,
          operatorWaitHours: 2,
        }),
        "tester",
      );
      expect((await repo.settings())!.operator_wait_hours).toBe(2);
      await act(repo, id, "wait-record-2", "record-action");
      expect(await repo.expireOperatorWaits(Date.now() + 1 * HOUR)).toBe(0);
      expect(await repo.expireOperatorWaits(Date.now() + 3 * HOUR)).toBe(1);
      // Omitting the field keeps the stored timeout.
      await repo.saveSettings(
        settingsSchema.parse({ dailyAiLimit: 10, aiEnabled: true, inputPrice: null, outputPrice: null, retentionDays: 30 }),
        "tester",
      );
      expect((await repo.settings())!.operator_wait_hours).toBe(2);
      expect(settingsSchema.safeParse({ dailyAiLimit: 10, aiEnabled: true, inputPrice: null, outputPrice: null, retentionDays: 30, operatorWaitHours: 0 }).success).toBe(false);
      expect(await other.expireOperatorWaits(Date.now() + 3 * HOUR)).toBe(0);
      await act(repo, id, "wait-dismiss", "dismiss");
    });
  });

  describe("recovery comparison with the baseline", () => {
    it("records the baseline comparison at resolution and discloses missing telemetry", async () => {
      const id = await resolveIncident(repo, "rec-1", "deployment-regression", "api");
      const { incident } = (await repo.incident(id))!;
      expect(incident.status).toBe("resolved");
      const report = JSON.parse(incident.recovery_report!);
      expect(report.healthyRuns).toBe(3);
      expect(report.baseline.samples).toBeGreaterThan(0);
      expect(report.baseline.medianLatencyMs).toBe(90);
      expect(report.recovery.medianLatencyMs).toBe(90);
      expect(report.latencyRatio).toBe(1);
      expect(report.withinBaseline).toBe(true);
      expect(report.disclosures).toContain(
        "No provider telemetry was collected after verification; recovery is based on probes only.",
      );
      expect(report.disclosures.some((d: string) => /database cause/.test(d))).toBe(false);
    });

    it("says probe recovery cannot confirm a database cause", async () => {
      const id = await resolveIncident(repo, "rec-db", "database-slowdown", "db");
      const report = JSON.parse((await repo.incident(id))!.incident.recovery_report!);
      expect(report.disclosures).toContain(
        "Probe recovery shows transport health only; it does not confirm the database cause.",
      );
    });

    it("reports missing baseline and progress while verification is still running", async () => {
      await pause();
      const id = (await other.scenario("database-slowdown", "rec-nobase", "tester", "db")).incident!.id;
      await other.saveEvidence(id);
      await other.complete(id, { status: "completed" }, "completed");
      await act(other, id, "rec-nobase-verify", "verify");
      await healthyRuns(other, "rec-nobase-recovery", "db", 1);
      const report = (await other.recoveryReport(id))!;
      expect(report.healthyRuns).toBe(1);
      expect(report.baseline.medianLatencyMs).toBeNull();
      expect(report.withinBaseline).toBeNull();
      expect(report.disclosures).toContain(
        "No healthy probe samples exist before the incident, so latency was not compared with a baseline.",
      );
      expect(await repo.recoveryReport(id)).toBeNull();
    });
  });
  describe("targeted follow-up queries", () => {
    // Drives the real Workflow with a step runner that records step names and, like
    // Workflows, returns a step's saved result instead of running it again.
    const runWorkflow = async (target: Operations, incidentId: string, runEnv: Env) => {
      const steps: string[] = [];
      const cache = new Map<string, unknown>();
      const step = {
        do: async <T>(name: string, _config: unknown, fn: () => Promise<T>) => {
          steps.push(name);
          if (!cache.has(name)) cache.set(name, await fn());
          return cache.get(name) as T;
        },
      };
      const workflow = new InvestigationWorkflow({} as never, { ...runEnv, DB: target.db } as Env);
      const outcome = await workflow.run(
        { payload: { scope: target.scope, incidentId, attempt: 1 } } as never,
        step as never,
      );
      const result = JSON.parse((await target.incident(incidentId))!.run!.result!);
      return { steps, outcome, result };
    };
    const detectFront = async (key: string) => {
      await pause();
      await repo.scenario("database-slowdown", `${key}-db`, "tester", "db");
      await pause();
      return (await repo.scenario("deployment-regression", `${key}-front`, "tester", "front")).incident!.id;
    };
    beforeAll(async () => {
      await repo.saveService(
        serviceSchema.parse({ id: "front", name: "Front", kind: "synthetic", dependencies: ["db"] }),
        "tester",
      );
    });
    const closeAll = async (target: Operations, prefix: string) => {
      for (const i of (await target.overview()).incidents)
        if (!["resolved", "dismissed"].includes(i.status))
          await act(target, i.id, `${prefix}-${i.id}`, "dismiss");
    };

    it("runs the requested query, then refines the summary with its cited result", async () => {
      const id = await detectFront("fu-1");
      const { steps, result } = await runWorkflow(repo, id, env);
      expect(steps).toEqual([
        "collect-provider-evidence",
        "persist-synthetic-evidence",
        "bounded-summary",
        "follow-up-queries",
        "refined-summary",
        "persist-summary",
      ]);
      expect(result.followUps).toEqual({
        requested: ["dependency-health"],
        ran: ["dependency-health"],
        refined: true,
      });
      const evidenceId = `${id}-followup-dependency-health`;
      const evidence = (await repo.incident(id))!.evidence.find((e) => e.id === evidenceId)!;
      expect(evidence.provider).toBe("follow-up:dependency-health");
      expect(JSON.parse(evidence.summary).dependencies[0]).toMatchObject({ serviceId: "db", health: "unhealthy" });
      const cited = result.finding.observations.find((o: { evidenceIds: string[] }) =>
        o.evidenceIds.includes(evidenceId),
      );
      expect(cited.text).toMatch(/Dependency db is also unhealthy/);
      // The final round cannot ask for more: exactly two metered model calls.
      expect(result.finding.followUps).toBeUndefined();
      const calls = await count(
        repo,
        "SELECT COUNT(*) AS n FROM ai_calls WHERE scope=? AND substr(id,1,length(?2))=?2",
        `investigation:${id}:a1`,
      );
      expect(calls).toBe(2);
      await closeAll(repo, "fu-1-close");
    });

    it("keeps the first summary when the refined summary is unavailable", async () => {
      const id = await detectFront("fu-2");
      // The refinement's budget reservation is already taken, so the call is refused.
      await repo
        .stmt(
          "INSERT INTO ai_calls(scope,id,day,created_at) VALUES(?,?,?,?)",
          `investigation:${id}:a1:r2`,
          new Date().toISOString().slice(0, 10),
          new Date().toISOString(),
        )
        .run();
      const { result } = await runWorkflow(repo, id, env);
      expect(result.status).toBe("completed");
      expect(result.followUps).toMatchObject({
        ran: ["dependency-health"],
        refined: false,
        reason: "budget_exceeded_or_call_already_reserved",
      });
      expect(result.finding.followUps).toEqual(["dependency-health"]);
      expect((await repo.incident(id))!.incident.status).toBe("awaiting_operator");
      await closeAll(repo, "fu-2-close");
    });

    it("skips follow-ups when the first summary does not ask for any", async () => {
      await pause();
      const id = (await repo.scenario("deployment-regression", "fu-3", "tester", "api")).incident!.id;
      const { steps, result } = await runWorkflow(repo, id, env);
      expect(steps).not.toContain("follow-up-queries");
      expect(result.followUps).toBeUndefined();
      await closeAll(repo, "fu-3-close");
    });

    it("runs only known queries, at most two, records gaps and respects the attempt", async () => {
      await pause();
      const id = (await repo.scenario("deployment-regression", "fu-4", "tester", "api")).incident!.id;
      await repo.saveEvidence(id);
      const ran = await repo.followUpEvidence(id, 1, [
        "worker-logs",
        "worker-logs",
        "DROP TABLE incidents",
        "recent-deployments",
        "probe-history-24h",
      ]);
      expect(ran).toEqual(["worker-logs", "recent-deployments"]);
      const evidence = (await repo.incident(id))!.evidence.filter((e) => e.provider.startsWith("follow-up:"));
      expect(evidence.map((e) => JSON.parse(e.summary))).toEqual([
        { gap: "No current deployments telemetry for this service." },
        { gap: "No current logs telemetry for this service." },
      ]);
      const history = await repo.followUpEvidence(id, 1, ["probe-history-24h", "dependency-health"]);
      expect(history).toEqual(["probe-history-24h", "dependency-health"]);
      const probe = JSON.parse(
        (await repo.incident(id))!.evidence.find((e) => e.provider === "follow-up:probe-history-24h")!.summary,
      );
      expect(probe.samples).toBeGreaterThan(0);
      expect(probe.counts.unhealthy).toBeGreaterThan(0);
      expect(JSON.parse(
        (await repo.incident(id))!.evidence.find((e) => e.provider === "follow-up:dependency-health")!.summary,
      )).toEqual({ gap: "The service has no registered dependencies." });
      // A stale attempt, another environment, or an unknown incident writes nothing.
      expect(await repo.followUpEvidence(id, 2, ["probe-history-24h"])).toEqual([]);
      expect(await other.followUpEvidence(id, 1, ["probe-history-24h"])).toEqual([]);
      expect(await repo.followUpEvidence("missing", 1, ["probe-history-24h"])).toEqual([]);
      await closeAll(repo, "fu-4-close");
    });

    it("lets a remote model request follow-ups by name only, and never in the final round", async () => {
      await pause();
      const id = (await repo.scenario("deployment-regression", "fu-5", "tester", "api")).incident!.id;
      const evidence = await repo.saveEvidence(id);
      const payloads: { messages: { content: string }[]; response_format: { json_schema: { properties: Record<string, unknown> } } }[] = [];
      const model = (answer: unknown) =>
        ({
          AI_MODE: "remote",
          MODE: "private",
          DAILY_AI_LIMIT: "100",
          AI: {
            run: async (_m: string, input: (typeof payloads)[number]) => {
              payloads.push(input);
              return { response: JSON.stringify(answer) };
            },
          },
        }) as unknown as Env;
      const base = {
        summary: "Probe failures after a deployment.",
        observations: [{ text: "Failures.", evidenceIds: [evidence[0].id] }],
        hypotheses: [],
        recommendations: ["Compare revisions."],
        unknowns: ["Logs missing."],
      };
      const first = await summarize(
        model({ ...base, followUps: ["worker-logs", "worker-logs"] }),
        repo,
        `fu-remote-${crypto.randomUUID()}`,
        evidence,
      );
      expect(first.status).toBe("completed");
      expect((first as { finding: { followUps?: string[] } }).finding.followUps).toEqual(["worker-logs"]);
      expect(payloads[0].messages[0].content).toContain("you may request at most 2 followUps");
      expect(Object.keys(payloads[0].response_format.json_schema.properties)).toContain("followUps");
      // Anything outside the catalog (free text, SQL, URLs) fails validation.
      const rogue = await summarize(
        model({ ...base, followUps: ["SELECT * FROM incidents"] }),
        repo,
        `fu-remote-${crypto.randomUUID()}`,
        evidence,
      );
      expect(rogue.status).toBe("partial");
      expect(
        (await summarize(model({ ...base, followUps: [...FOLLOW_UPS] }), repo, `fu-remote-${crypto.randomUUID()}`, evidence)).status,
      ).toBe("partial");
      // Final round: no offer in the prompt or schema, and a request is dropped.
      const final = await summarize(
        model({ ...base, followUps: ["worker-logs"] }),
        repo,
        `fu-remote-${crypto.randomUUID()}`,
        evidence,
        { final: true },
      );
      expect(final.status).toBe("completed");
      expect((final as { finding: { followUps?: string[] } }).finding.followUps).toBeUndefined();
      const last = payloads.at(-1)!;
      expect(last.messages[0].content).toContain("This is the final round");
      expect(Object.keys(last.response_format.json_schema.properties)).not.toContain("followUps");
      await closeAll(repo, "fu-5-close");
    });
  });
});
