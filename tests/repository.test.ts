import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Repository } from "../src/repository";
import { summarize } from "../src/inference";
import type { Env } from "../src/types";
import { reconcile } from "../src/dispatch";

describe("D1 state ownership and replay", () => {
  let mf: Miniflare;
  let repo: Repository;
  beforeAll(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default {fetch(){return new Response("ok")}}',
        d1Databases: ["DB"],
        compatibilityDate: "2026-11-24",
      }),
    );
    const db = await mf.getD1Database("DB");
    const sql =
      (await readFile(
        new URL("../migrations/0001_foundation.sql", import.meta.url),
        "utf8",
      )) +
      "\n" +
      (await readFile(
        new URL("../migrations/0002_operations.sql", import.meta.url),
        "utf8",
      )) +
      "\n" +
      (await readFile(
        new URL("../migrations/0003_conversation_activity.sql", import.meta.url),
        "utf8",
      )) +
      "\n" +
      (await readFile(
        new URL("../migrations/0004_investigation_history.sql", import.meta.url),
        "utf8",
      )) +
      "\n" +
      (await readFile(
        new URL("../migrations/0005_recommendations_delivery.sql", import.meta.url),
        "utf8",
      ));
    // D1 exec accepts one statement per line; preserve actual schema rather than a mock.
    await db.exec(sql.replace(/\n/g, " "));
    repo = new Repository(db as unknown as D1Database, "synthetic/demo");
  }, 30_000);
  afterAll(async () => {
    await mf?.dispose();
  });
  it("persists healthy and insufficient samples without incident or AI work", async () => {
    expect(
      (await repo.scenario("healthy", "healthy-001", "test")).incident,
    ).toBeNull();
    expect(
      (await repo.scenario("insufficient-data", "unknown-001", "test")).health,
    ).toBe("unknown");
    expect(
      (
        await repo.db
          .prepare("SELECT COUNT(*) n FROM ai_calls")
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    const overview = await repo.overview();
    expect(overview.incidents).toHaveLength(0);
    expect(overview.samples).toHaveLength(1);
    expect(overview.samples[0]).toEqual({
      observedAt: "2026-11-24T08:00:00.000Z",
      status: "healthy",
      latencyMs: 90,
    });
    expect(overview.health).toBe("unknown");
  });
  it("deduplicates concurrent detections and atomically persists dispatch intent", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        repo.scenario("deployment-regression", `failure-00${i}`, "test"),
      ),
    );
    expect(new Set(results.map((r) => r.incident?.id)).size).toBe(1);
    expect((await repo.overview()).incidents).toHaveLength(1);
    expect(
      (
        await repo.db
          .prepare("SELECT COUNT(*) n FROM dispatch_outbox")
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    const original = results[0].incident!.id;
    expect(
      (await repo.scenario("deployment-regression", "failure-000", "test"))
        .incident?.id,
    ).toBe(original);
    await expect(
      repo.scenario("healthy", "failure-000", "test"),
    ).rejects.toThrow("Idempotency");
  });
  it("hides incidents and evidence across scopes and makes evidence writes replay safe", async () => {
    const id = (await repo.overview()).incidents[0].id;
    await repo.saveEvidence(id);
    await repo.saveEvidence(id);
    const detail = await repo.incident(id);
    expect(detail?.evidence).toHaveLength(2);
    expect(detail?.incident.status).toBe("investigating");
    expect(detail?.incident.version).toBe(2);
    expect(
      await new Repository(repo.db, "unauthorized/environment").incident(id),
    ).toBeNull();
    expect(
      (await new Repository(repo.db, "unauthorized/environment").overview())
        .services,
    ).toHaveLength(0);
    await expect(
      new Repository(repo.db, "unauthorized/environment").saveEvidence(id),
    ).rejects.toThrow();
  });
  it("enforces an atomic daily inference cap including simultaneous callers", async () => {
    const reservations = await Promise.all(
      Array.from({ length: 5 }, (_, i) => repo.reserveAI(`test-cap-${i}`, 2)),
    );
    expect(reservations.filter(Boolean)).toHaveLength(2);
    expect(await repo.reserveAI("blocked", 0)).toBe(false);
    const accepted = reservations.findIndex(Boolean);
    expect(await repo.reserveAI(`test-cap-${accepted}`, 100)).toBe(false);
  });
  it("saves validated fixture output once and preserves it on replay", async () => {
    const id = (await repo.overview()).incidents[0].id;
    const evidence = (await repo.incident(id))!.evidence;
    const result = await summarize(
      { AI_MODE: "fixture", MODE: "development", DAILY_AI_LIMIT: "10" } as Env,
      repo,
      `summary:${id}`,
      evidence,
    );
    expect(result.status).toBe("completed");
    await repo.complete(id, result, result.status);
    await repo.complete(id, { reason: "overwrite attempt" }, "partial");
    const saved = await repo.incident(id);
    expect(JSON.parse(saved!.run!.result!)).toEqual(result);
    expect(saved?.incident.status).toBe("awaiting_operator");
    expect(saved?.incident.version).toBe(3);
  });
  it("retains dispatch intent after failure and attaches to an existing Workflow after a crash", async () => {
    const id = (await repo.overview()).incidents[0].id;
    let creates = 0;
    const env = {
      DB: repo.db,
      INVESTIGATION: {
        get: async () => {
          throw new Error("missing");
        },
        create: async () => {
          creates++;
          throw new Error("unavailable");
        },
      },
    } as unknown as Env;
    await reconcile(env, repo.scope);
    const pending = await repo
      .stmt(
        "SELECT state,attempts FROM dispatch_outbox WHERE scope = ? AND id = ?",
        id,
      )
      .first<{ state: string; attempts: number }>();
    expect(pending).toEqual({ state: "pending", attempts: 1 });
    await repo
      .stmt(
        "UPDATE dispatch_outbox SET next_attempt_at = '2000-01-01' WHERE scope = ? AND id = ?",
        id,
      )
      .run();
    env.INVESTIGATION.get = async () =>
      ({
        status: async () => ({ status: "complete" }),
      }) as unknown as WorkflowInstance;
    await reconcile(env, repo.scope);
    await reconcile(env, repo.scope);
    expect(creates).toBe(1);
    expect(
      (
        await repo
          .stmt(
            "SELECT state FROM dispatch_outbox WHERE scope = ? AND id = ?",
            id,
          )
          .first<{ state: string }>()
      )?.state,
    ).toBe("sent");
  });
  it("fails safely for invalid remote output and never repeats a reserved call", async () => {
    const id = (await repo.overview()).incidents[0].id;
    const evidence = (await repo.incident(id))!.evidence;
    let calls = 0;
    const env = {
      AI_MODE: "remote",
      DAILY_AI_LIMIT: "10",
      AI: {
        run: async () => {
          calls++;
          return {
            response: '{"summary":"untrusted incomplete model payload"}',
          };
        },
      },
    } as unknown as Env;
    const result = await summarize(env, repo, "invalid-remote", evidence);
    expect(result.status).toBe("partial");
    expect(result).toHaveProperty("reason", "model_failed_or_invalid_output");
    expect(
      (await summarize(env, repo, "invalid-remote", evidence)).status,
    ).toBe("partial");
    expect(calls).toBe(1);
    expect(
      (
        await summarize(
          { ...env, DAILY_AI_LIMIT: "0" },
          repo,
          "budget-zero",
          evidence,
        )
      ).status,
    ).toBe("partial");
    expect(calls).toBe(1);
  });
});
