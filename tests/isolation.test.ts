import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Operations } from "../src/operations";
import { NotFound } from "../src/repository";
import { serviceSchema } from "../src/contracts";

// Two independent demo environments in one workspace. Every lookup by ID from the
// wrong environment must behave exactly like a missing record and change nothing.
describe("notifications and cross-environment ID swaps", () => {
  let mf: Miniflare, a: Operations, b: Operations;
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
    a = new Operations(db, "synthetic/demo");
    await a.createScope(
      { applicationId: "otherapp", applicationName: "Other app", environment: "demo", mode: "demo" },
      "tester",
    );
    b = new Operations(db, "otherapp/demo");
    for (const repo of [a, b])
      await repo.saveService(
        serviceSchema.parse({ id: "api", name: "API", kind: "synthetic" }),
        "tester",
      );
  }, 30_000);
  afterAll(async () => await mf?.dispose());

  const detect = (repo: Operations, key: string) =>
    repo.scenario("deployment-regression", key, "tester", "api");
  const count = async (repo: Operations, sql: string, ...args: string[]) =>
    (await repo.stmt(sql, ...args).first<{ n: number }>())!.n;

  describe("notifications", () => {
    it("creates one notification per incident despite replays and concurrent detections", async () => {
      const first = await detect(a, "notify-first");
      await detect(a, "notify-first");
      await Promise.all(
        Array.from({ length: 5 }, (_, i) => detect(a, `notify-concurrent-${i}`)),
      );
      const id = first.incident!.id;
      const notes = (await a.notifications()) as { id: string; incident_id: string }[];
      expect(notes.filter((n) => n.incident_id === id)).toHaveLength(1);
      expect(notes).toHaveLength(1);
    });

    it("creates a new notification for a recurrence after the incident is closed", async () => {
      const [incident] = (await a.overview()).incidents;
      await a.operator(
        incident.id,
        "notify-dismiss",
        { action: "dismiss", expectedVersion: incident.version, note: "False positive." },
        "tester",
      );
      const recurrence = (await detect(a, "notify-recurrence")).incident!;
      expect(recurrence.id).not.toBe(incident.id);
      const notes = (await a.notifications()) as { incident_id: string }[];
      expect(notes.map((n) => n.incident_id).sort()).toEqual(
        [incident.id, recurrence.id].sort(),
      );
    });

    it("lists only the environment's own notifications", async () => {
      expect(await b.notifications()).toEqual([]);
      const own = (await detect(b, "notify-other")).incident!.id;
      const listed = (await b.notifications()) as { incident_id: string }[];
      expect(listed.map((n) => n.incident_id)).toEqual([own]);
      expect(
        ((await a.notifications()) as { incident_id: string }[]).some(
          (n) => n.incident_id === own,
        ),
      ).toBe(false);
    });

    it("marks read idempotently and keeps the first read time", async () => {
      const [note] = (await a.notifications()) as { id: string }[];
      const first = await a.markNotificationRead(note.id);
      expect(first.read).toBe(true);
      expect(first.readAt).toBeTruthy();
      await new Promise((r) => setTimeout(r, 5));
      expect((await a.markNotificationRead(note.id)).readAt).toBe(first.readAt);
    });

    it("refuses to mark another environment's notification and leaves it unread", async () => {
      const [foreign] = (await b.notifications()) as { id: string; read_at: string | null }[];
      expect(foreign.read_at).toBeNull();
      await expect(a.markNotificationRead(foreign.id)).rejects.toBeInstanceOf(NotFound);
      await expect(a.markNotificationRead("does-not-exist")).rejects.toBeInstanceOf(NotFound);
      const after = (await b.notifications()) as { id: string; read_at: string | null }[];
      expect(after.find((n) => n.id === foreign.id)?.read_at).toBeNull();
    });
  });

  describe("ID swaps between environments", () => {
    it("hides incidents, events, evidence and runs from the other environment", async () => {
      const own = (await b.overview()).incidents[0].id;
      expect(await a.incident(own)).toBeNull();
      expect(await a.events(own)).toEqual([]);
      await expect(a.saveEvidence(own)).rejects.toThrow();
      const before = await b.incident(own);
      // A late Workflow result addressed through the wrong environment changes nothing.
      await a.complete(own, { summary: "foreign write" }, "completed");
      expect(await b.incident(own)).toEqual(before);
    });

    it("rejects operator actions on another environment's incident without side effects", async () => {
      const target = (await b.overview()).incidents[0];
      const versionBefore = target.version;
      expect(
        await a.operator(
          target.id,
          "swap-dismiss",
          { action: "dismiss", expectedVersion: target.version, note: "Not yours." },
          "intruder",
        ),
      ).toBeNull();
      const after = (await b.incident(target.id))!;
      expect(after.incident.status).toBe(target.status);
      expect(after.incident.version).toBe(versionBefore);
      expect(await count(a, "SELECT COUNT(*) AS n FROM incident_events WHERE scope=? AND id='swap-dismiss'")).toBe(0);
      expect(await count(b, "SELECT COUNT(*) AS n FROM incident_events WHERE scope=? AND id='swap-dismiss'")).toBe(0);
    });

    it("treats another environment's lesson as not found and keeps its memory revision", async () => {
      const incident = (await b.overview()).incidents[0].id;
      await b
        .stmt(
          "INSERT INTO knowledge_entries(scope,id,incident_id,content,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?)",
          "b-lesson",
          incident,
          "Connection pool exhausted.",
          "tester",
          new Date().toISOString(),
        )
        .run();
      const revision = async (repo: Operations) =>
        (await repo.stmt("SELECT memory_revision AS r FROM settings WHERE scope=?").first<{ r: number }>())!.r;
      const [aRevision, bRevision] = [await revision(a), await revision(b)];
      await expect(a.updateMemory("b-lesson", 1, "Rewritten by intruder", "intruder")).rejects.toBeInstanceOf(NotFound);
      await expect(a.updateMemory("b-lesson", 1, null, "intruder")).rejects.toBeInstanceOf(NotFound);
      expect((await b.memory()).find((k) => k.id === "b-lesson")?.content).toBe(
        "Connection pool exhausted.",
      );
      expect(await a.memory()).toEqual([]);
      expect([await revision(a), await revision(b)]).toEqual([aRevision, bRevision]);
      // In its own environment a stale version is a conflict, not "not found".
      await expect(b.updateMemory("b-lesson", 99, "Stale edit", "tester")).rejects.toThrow(
        /changed/,
      );
    });

    it("does not let one environment configure or depend on another's services", async () => {
      await b.saveService(
        serviceSchema.parse({ id: "b-only", name: "B only", kind: "synthetic" }),
        "tester",
      );
      await expect(
        a.saveService(
          serviceSchema.parse({
            id: "front",
            name: "Front",
            kind: "synthetic",
            dependencies: ["b-only"],
          }),
          "tester",
        ),
      ).rejects.toThrow(/outside this scope/);
      expect((await a.services()).some((s) => s.id === "b-only")).toBe(false);
    });
  });
});
