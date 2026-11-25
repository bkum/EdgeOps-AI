import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { ZodError } from "zod";
import { Operations } from "../src/operations";
import { Conflict, NotFound } from "../src/repository";
import { serviceSchema } from "../src/contracts";
import { validateFinding } from "../src/domain";
import { pageQuerySchema } from "../src/pagination";
import { deliverNotifications, destinationsStatus, webhookURL, MAX_DELIVERY_ATTEMPTS } from "../src/notify";
import { ProvisionalText, parseStreamedAnswer, readAiStream } from "../src/stream";
import { chatAnswer } from "../src/chat";
import { withoutSecrets } from "../src/sanitize";
import type { Env } from "../src/types";

const pause = () => new Promise((r) => setTimeout(r, 3));
const MIN = 60_000;

// Recommendations as records, cursor pagination, external notification delivery and
// provisional answer streaming.
describe("recommendations, pagination, delivery and streaming", () => {
  let mf: Miniflare, repo: Operations, other: Operations;
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
        (await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8")).replace(/\n/g, " "),
      );
    other = new Operations(db, "synthetic/demo");
    await other.createScope(
      { applicationId: "delivery", applicationName: "Delivery", environment: "demo", mode: "demo" },
      "tester",
    );
    repo = new Operations(db, "delivery/demo");
    for (const target of [repo, other])
      await target.saveService(serviceSchema.parse({ id: "api", name: "API", kind: "synthetic" }), "tester");
  }, 30_000);
  afterAll(async () => await mf?.dispose());

  const act = async (target: Operations, id: string, key: string, action: string) => {
    const { incident } = (await target.incident(id))!;
    return target.operator(id, key, { action, expectedVersion: incident.version, note: `${action} by test` } as never, "tester");
  };
  const closeAll = async (target: Operations, prefix: string) => {
    for (const i of (await target.overview()).incidents)
      if (!["resolved", "dismissed"].includes(i.status)) await act(target, i.id, `${prefix}-${i.id}`, "dismiss");
  };
  const detect = async (target: Operations, key: string) => {
    await pause();
    const id = (await target.scenario("deployment-regression", key, "tester", "api")).incident!.id;
    const evidence = await target.saveEvidence(id);
    return { id, evidence };
  };
  const findingWith = (evidenceId: string) => ({
    status: "completed",
    mode: "remote",
    finding: {
      summary: "Probe failures after a deployment.",
      observations: [{ text: "Failures.", evidenceIds: [evidenceId] }],
      hypotheses: [],
      recommendations: [
        "Compare the current revision with the previous one.",
        { action: "Roll back revision demo-b", rationale: "Failures began after it deployed.", evidenceIds: [evidenceId] },
      ],
      unknowns: ["No logs."],
    },
  });

  describe("recommendations", () => {
    it("persists each recommendation of the completed attempt once, with rationale and evidence", async () => {
      const { id, evidence } = await detect(repo, "rec-1");
      const result = findingWith(evidence[0].id);
      await repo.complete(id, result, "completed");
      await repo.complete(id, result, "completed");
      // A conflicting later completion and a stale attempt add nothing.
      await repo.complete(id, { ...result, finding: { ...result.finding, recommendations: ["a", "b", "c"] } }, "completed");
      await repo.complete(id, result, "completed", 2);
      const recs = await repo.recommendations(id);
      expect(recs.map((r) => [r.id, r.action, r.rationale, r.evidence_ids, r.disposition, r.source])).toEqual([
        [`${id}-a1-r1`, "Compare the current revision with the previous one.", null, [], "proposed", "remote"],
        [`${id}-a1-r2`, "Roll back revision demo-b", "Failures began after it deployed.", [evidence[0].id], "proposed", "remote"],
      ]);
    });

    it("records the operator's disposition with versioning and hides other environments", async () => {
      const [incident] = (await repo.overview()).incidents;
      const [first] = await repo.recommendations(incident.id);
      const accepted = (await repo.disposeRecommendation(
        incident.id,
        first.id,
        { disposition: "accepted", expectedVersion: 1, note: "Doing it now." },
        "operator-a",
      ))!;
      expect(accepted).toMatchObject({ disposition: "accepted", disposition_by: "operator-a", disposition_note: "Doing it now.", version: 2 });
      await expect(
        repo.disposeRecommendation(incident.id, first.id, { disposition: "done", expectedVersion: 1 }, "operator-b"),
      ).rejects.toBeInstanceOf(Conflict);
      await expect(
        other.disposeRecommendation(incident.id, first.id, { disposition: "rejected", expectedVersion: 2 }, "intruder"),
      ).rejects.toBeInstanceOf(NotFound);
      await expect(
        repo.disposeRecommendation("other-incident", first.id, { disposition: "done", expectedVersion: 2 }, "operator"),
      ).rejects.toBeInstanceOf(NotFound);
      expect(await other.recommendations(incident.id)).toEqual([]);
      // Disposition never changes the incident itself.
      expect((await repo.incident(incident.id))!.incident.status).toBe("awaiting_operator");
    });

    it("lists only the current attempt's recommendations after a retry", async () => {
      await closeAll(repo, "rec-before-retry");
      const { id, evidence } = await detect(repo, "rec-retry");
      await repo.complete(id, { status: "partial", mode: "remote", finding: findingWith(evidence[0].id).finding }, "partial");
      await act(repo, id, "rec-retry-1", "retry");
      const fresh = await repo.saveEvidence(id, 2);
      await repo.complete(
        id,
        { ...findingWith(fresh[0].id), finding: { ...findingWith(fresh[0].id).finding, recommendations: ["Check the connection pool."] } },
        "completed",
        2,
      );
      expect((await repo.recommendations(id)).map((r) => [r.id, r.action])).toEqual([[`${id}-a2-r1`, "Check the connection pool."]]);
      await closeAll(repo, "rec-close");
    });

    it("rejects a recommendation that cites evidence the model was not given", () => {
      const finding = findingWith("ev-1").finding;
      expect(() => validateFinding(finding, ["ev-1"])).not.toThrow();
      expect(() => validateFinding(finding, ["ev-2", "ev-1"].slice(0, 1))).toThrow("Invalid evidence citation");
    });

    it("purges recommendations with their closed incident", async () => {
      const { id, evidence } = await detect(repo, "rec-purge");
      await repo.complete(id, findingWith(evidence[0].id), "completed");
      await act(repo, id, "rec-purge-dismiss", "dismiss");
      await repo.stmt("UPDATE incidents SET resolved_at='2020-01-01T00:00:00.000Z' WHERE scope=? AND id=?", id).run();
      await repo.purge();
      expect(await repo.incident(id)).toBeNull();
      expect(
        (await repo.stmt("SELECT COUNT(*) AS n FROM recommendations WHERE scope=? AND incident_id=?", id).first<{ n: number }>())!.n,
      ).toBe(0);
    });
  });

  describe("cursor pagination", () => {
    it("walks a list in stable pages without repeats, even when rows arrive mid-walk", async () => {
      for (let i = 0; i < 7; i++) await repo.audit("tester", `page.${i}`, "ok");
      const seen: string[] = [];
      let cursor: string | undefined;
      let page = await repo.page("audit", { limit: 3 });
      seen.push(...page.items.map((r) => String(r.id)));
      const actions = page.items.map((r) => String(r.action));
      // New rows after the first page must not shift the next pages.
      await repo.audit("tester", "page.late", "ok");
      while (page.nextCursor) {
        cursor = page.nextCursor;
        page = await repo.page("audit", { limit: 3, cursor });
        seen.push(...page.items.map((r) => String(r.id)));
        actions.push(...page.items.map((r) => String(r.action)));
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(actions.slice(0, 7)).toEqual(["page.6", "page.5", "page.4", "page.3", "page.2", "page.1", "page.0"]);
      expect(actions).not.toContain("page.late");
      expect(seen.map(Number)).toEqual([...seen.map(Number)].sort((a, b) => b - a));
      expect(page.nextCursor).toBeNull();
    });

    it("breaks ties on equal timestamps by ID", async () => {
      const { id } = await detect(repo, "page-ties");
      for (const n of ["n1", "n2", "n3", "n4", "n5"])
        await repo
          .stmt("INSERT INTO notifications(scope,id,incident_id,title,created_at) VALUES(?,?,?,?,?)", `tie-${n}`, id, "Tie", "2030-01-01T00:00:00.000Z")
          .run();
      const ids: string[] = [];
      let page = await repo.page("notifications", { limit: 2 });
      ids.push(...page.items.map((r) => String(r.id)));
      while (page.nextCursor) {
        page = await repo.page("notifications", { limit: 2, cursor: page.nextCursor });
        ids.push(...page.items.map((r) => String(r.id)));
      }
      expect(ids.slice(0, 5)).toEqual(["tie-n5", "tie-n4", "tie-n3", "tie-n2", "tie-n1"]);
      expect(new Set(ids).size).toBe(ids.length);
      expect((await other.page("notifications", { limit: 100 })).items.some((r) => String(r.id).startsWith("tie-"))).toBe(false);
      await closeAll(repo, "page-close");
    });

    it("rejects cursors from another list, tampered cursors and oversized limits", async () => {
      const page = await repo.page("audit", { limit: 1 });
      await expect(repo.page("notifications", { cursor: page.nextCursor! })).rejects.toBeInstanceOf(ZodError);
      await expect(repo.page("audit", { cursor: "not-a-cursor" })).rejects.toBeInstanceOf(ZodError);
      await expect(repo.page("audit", { cursor: btoa(JSON.stringify(["audit", "1 OR 1=1", "x"])) })).rejects.toBeInstanceOf(ZodError);
      expect(pageQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
      expect(pageQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
      expect(pageQuerySchema.safeParse({ limit: "25" }).data).toEqual({ limit: 25 });
      expect(pageQuerySchema.safeParse({ offset: "5" }).success).toBe(false);
    });
  });

  describe("external notification delivery", () => {
    const url = "https://hooks.receiver.net/services/T000/B000/canary-webhook-secret";
    const webhookEnv = (destinations: unknown) =>
      ({ NOTIFICATION_WEBHOOKS: JSON.stringify(destinations) }) as unknown as Env;
    const env = webhookEnv([
      { scope: "delivery/demo", url },
      { scope: "synthetic/demo", url: "https://hooks.receiver.net/other-scope" },
    ]);
    // A receiver plus DNS-over-HTTPS answers; records every webhook POST.
    const receiver = (statuses: number[], address = "93.184.216.34") => {
      const posts: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
      const fetcher = (async (input: string | URL, init?: RequestInit) => {
        const target = String(input);
        if (target.startsWith("https://cloudflare-dns.com/"))
          return Response.json(
            target.endsWith("type=A") ? { Status: 0, Answer: [{ type: 1, data: address }] } : { Status: 0, Answer: [] },
          );
        posts.push({ url: target, body: JSON.parse(String(init!.body)), headers: new Headers(init!.headers) });
        return new Response(null, { status: statuses[Math.min(posts.length - 1, statuses.length - 1)] });
      }) as typeof fetch;
      return { posts, fetcher };
    };
    const state = async () =>
      (await repo.stmt("SELECT state,attempts,last_error,next_attempt_at FROM notification_deliveries WHERE scope=? ORDER BY created_at", ).all<{
        state: string;
        attempts: number;
        last_error: string | null;
        next_attempt_at: string;
      }>()).results;
    const reset = async () => {
      await closeAll(repo, `reset-${crypto.randomUUID()}`);
      await repo.stmt("DELETE FROM notification_deliveries WHERE scope=?").run();
      await repo.stmt("DELETE FROM notifications WHERE scope=?").run();
    };

    it("delivers each new notification once, with identifiers only and an idempotency key", async () => {
      await reset();
      const { id } = await detect(repo, "deliver-1");
      const { posts, fetcher } = receiver([204]);
      expect(await deliverNotifications(env, repo, fetcher)).toMatchObject({ enqueued: 1, sent: 1 });
      expect(await deliverNotifications(env, repo, fetcher)).toMatchObject({ enqueued: 0, sent: 0 });
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe(url);
      expect(posts[0].headers.get("idempotency-key")).toMatch(new RegExp(`^${id}:[0-9a-f]{16}$`));
      expect(Object.keys(posts[0].body).sort()).toEqual(
        ["createdAt", "id", "incidentId", "incidentStatus", "scope", "serviceId", "text", "title", "type"],
      );
      expect(posts[0].body).toMatchObject({ scope: "delivery/demo", incidentId: id, serviceId: "api" });
      // The stored row and the status view never contain the URL or its secret path.
      const rows = JSON.stringify(await repo.stmt("SELECT * FROM notification_deliveries WHERE scope=?").all());
      expect(rows).not.toContain("canary-webhook-secret");
      const status = await destinationsStatus(env, repo);
      expect(status).toEqual([expect.objectContaining({ host: "hooks.receiver.net", sent: 1, pending: 0, failed: 0 })]);
      expect(JSON.stringify(status)).not.toContain("canary-webhook-secret");
      expect(withoutSecrets(`posted to ${url}`, env)).toBe("posted to [REDACTED]");
    });

    it("retries transient failures with backoff and gives up after the attempt cap", async () => {
      await reset();
      await detect(repo, "deliver-retry");
      const { posts, fetcher } = receiver([503]);
      let now = Date.now();
      expect(await deliverNotifications(env, repo, fetcher, now)).toMatchObject({ retrying: 1 });
      // Not due again until the backoff passes.
      expect(await deliverNotifications(env, repo, fetcher, now + 1 * MIN)).toMatchObject({ retrying: 0 });
      expect(posts).toHaveLength(1);
      for (let attempt = 2; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
        now += 61 * MIN;
        await deliverNotifications(env, repo, fetcher, now);
      }
      expect(posts).toHaveLength(MAX_DELIVERY_ATTEMPTS);
      expect(await state()).toEqual([expect.objectContaining({ state: "failed", attempts: 5, last_error: "http_503" })]);
      await deliverNotifications(env, repo, fetcher, now + 120 * MIN);
      expect(posts).toHaveLength(MAX_DELIVERY_ATTEMPTS);
    });

    it("fails permanently on a client error and refuses private or invalid destinations", async () => {
      await reset();
      await detect(repo, "deliver-400");
      const rejected = receiver([400]);
      await deliverNotifications(env, repo, rejected.fetcher);
      expect(await state()).toEqual([expect.objectContaining({ state: "failed", attempts: 1, last_error: "http_400" })]);

      await reset();
      await detect(repo, "deliver-private");
      const internal = receiver([204], "10.0.0.5");
      await deliverNotifications(env, repo, internal.fetcher);
      expect(internal.posts).toHaveLength(0);
      expect(await state()).toEqual([expect.objectContaining({ state: "failed", last_error: "private_resolution" })]);

      for (const bad of ["http://hooks.receiver.net/x", "https://user:pw@hooks.receiver.net/x", "https://hooks.receiver.net:8443/x", "https://localhost/x", "https://10.0.0.1/x"])
        expect(() => webhookURL(bad)).toThrow("destination_denied");
      // Unparseable configuration means no destinations at all.
      const { posts, fetcher } = receiver([204]);
      expect(await deliverNotifications({ NOTIFICATION_WEBHOOKS: "{not json" } as Env, repo, fetcher)).toMatchObject({ enqueued: 0 });
      expect(await deliverNotifications(webhookEnv([{ scope: "delivery/demo", url, extra: true }]), repo, fetcher)).toMatchObject({ enqueued: 0 });
      expect(posts).toHaveLength(0);
    });

    it("sends a concurrent run's delivery once, skips old history and other environments", async () => {
      await reset();
      await detect(repo, "deliver-race");
      await repo.stmt("UPDATE notifications SET created_at='2020-01-01T00:00:00.000Z' WHERE scope=?").run();
      const old = receiver([204]);
      expect(await deliverNotifications(env, repo, old.fetcher)).toMatchObject({ enqueued: 0 });
      await repo.stmt("UPDATE notifications SET created_at=?2 WHERE scope=?1", new Date().toISOString()).run();
      const { posts, fetcher } = receiver([204]);
      await Promise.all([deliverNotifications(env, repo, fetcher), deliverNotifications(env, repo, fetcher)]);
      expect(posts.filter((p) => p.url === url)).toHaveLength(1);
      expect(posts.some((p) => p.url.endsWith("other-scope"))).toBe(false);
    });

    it("formats Slack destinations as a single text field", async () => {
      await reset();
      const { id } = await detect(repo, "deliver-slack");
      const { posts, fetcher } = receiver([200]);
      await deliverNotifications(webhookEnv([{ scope: "delivery/demo", url, format: "slack" }]), repo, fetcher);
      expect(posts[0].body).toEqual({ text: expect.stringContaining(id) });
      await reset();
    });
  });

  describe("provisional answer streaming", () => {
    const collect = () => {
      const shown: string[] = [];
      return { shown, text: new ProvisionalText((t) => shown.push(t), { LOCAL_API_TOKEN: "local-canary-token-123" }) };
    };
    const sse = (frames: string[], split = 7) => {
      const body = frames.map((f) => `data: ${f}\n\n`).join("");
      const bytes = new TextEncoder().encode(body);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
          controller.close();
        },
      });
    };

    it("shows only whole, redacted sentences and never the trailer", () => {
      const { shown, text } = collect();
      for (const token of ["The probe ", "failed after", " the deploy. The db pass", "word is hunter2. Sec", "ond line\nEVIDENCE: ev-1\nUNKNOWNS: none"])
        text.push(token);
      // "password is hunter2." is redacted including its full stop.
      expect(shown.join("")).toBe("The probe failed after the deploy. The db [REDACTED] Second line");
      expect(shown.join("")).not.toContain("EVIDENCE");
    });

    it("holds back a credential introduced at a boundary, an open key block and configured secrets", () => {
      const { shown, text } = collect();
      text.push("Use header Authorization: Bearer\n");
      expect(shown).toEqual([]);
      text.push("abc.def-123 for the probe. ");
      expect(shown.join("")).not.toContain("abc.def-123");
      const key = collect();
      key.text.push("Key follows. -----BEGIN PRIVATE KEY-----\nMIICanary\n");
      expect(key.shown.join("")).toBe("Key follows. ");
      key.text.push("-----END PRIVATE KEY----- done.\n");
      expect(key.shown.join("")).not.toContain("MIICanary");
      const local = collect();
      local.text.push("The token local-canary-token-123 was used. ");
      expect(local.shown.join("")).not.toContain("local-canary-token-123");
    });

    it("parses the trailer and rejects unlisted citations or a missing trailer", () => {
      expect(parseStreamedAnswer("All good.\nEVIDENCE: ev-1, ev-1\nUNKNOWNS: logs; metrics", ["ev-1"])).toEqual({
        answer: "All good.",
        evidenceIds: ["ev-1"],
        unknowns: ["logs", "metrics"],
      });
      expect(parseStreamedAnswer("Fine.\nEVIDENCE: none\nUNKNOWNS: none", [])).toEqual({ answer: "Fine.", evidenceIds: [], unknowns: [] });
      expect(() => parseStreamedAnswer("x\nEVIDENCE: ev-9\nUNKNOWNS: none", ["ev-1"])).toThrow("citation_denied");
      expect(() => parseStreamedAnswer("no trailer at all", ["ev-1"])).toThrow("invalid_output");
      expect(() => parseStreamedAnswer("\nEVIDENCE: none\nUNKNOWNS: none", [])).toThrow("invalid_output");
    });

    it("reads a Workers AI event stream split at arbitrary byte boundaries", async () => {
      const tokens: string[] = [];
      const { usage } = await readAiStream(
        sse([
          JSON.stringify({ response: "Hel" }),
          JSON.stringify({ response: "lo é" }),
          JSON.stringify({ response: "", usage: { prompt_tokens: 3, completion_tokens: 2 } }),
          "[DONE]",
        ], 5),
        (t) => tokens.push(t),
      );
      expect(tokens.join("")).toBe("Hello é");
      expect(usage).toEqual({ prompt_tokens: 3, completion_tokens: 2 });
    });

    it("streams a remote chat answer only when enabled, and flags provisional text on failure", async () => {
      const { id, evidence } = await detect(repo, "stream-chat");
      await repo.complete(id, findingWith(evidence[0].id), "completed");
      const calls: Record<string, unknown>[] = [];
      const streamingEnv = (answer: string, streaming = "on") =>
        ({
          DB: repo.db,
          MODE: "development",
          AI_MODE: "remote",
          AI_STREAMING: streaming,
          DAILY_AI_LIMIT: "100",
          AI: {
            run: async (_m: string, input: Record<string, unknown>) => {
              calls.push(input);
              if (input.tools) return { tool_calls: [] };
              if (input.stream)
                return sse([...answer.match(/.{1,6}/gs)!.map((t) => JSON.stringify({ response: t })), "[DONE]"]);
              return {
                response: JSON.stringify({ answer: "Non-streamed answer.", evidenceIds: [evidence[0].id], unknowns: [] }),
              };
            },
          },
        }) as unknown as Env;
      const deltas: string[] = [];
      const ok = await chatAnswer(
        streamingEnv(`The probe failed after the deploy. Cause unconfirmed.\nEVIDENCE: ${evidence[0].id}\nUNKNOWNS: logs`),
        repo,
        "Why did it fail?",
        `stream-${crypto.randomUUID()}`,
        () => {},
        [],
        "tester",
        (t) => deltas.push(t),
      );
      expect(ok.status).toBe("ok");
      expect(ok.citations).toEqual([evidence[0].id]);
      expect("provisional" in ok && ok.provisional).toBe(true);
      expect(deltas).toEqual(["The probe failed after the deploy.", " Cause unconfirmed.\n"]);
      expect(ok.text).toContain("Cause unconfirmed.");
      expect(calls.at(-1)).toMatchObject({ stream: true });
      expect(calls.at(-1)).not.toHaveProperty("response_format");

      const denied = await chatAnswer(
        streamingEnv("Shown first. Then a bad cite.\nEVIDENCE: not-allowed\nUNKNOWNS: none"),
        repo,
        "Why?",
        `stream-${crypto.randomUUID()}`,
        () => {},
        [],
        "tester",
        () => {},
      );
      expect(denied.status).toBe("partial");
      expect("provisional" in denied && denied.provisional).toBe(true);

      const off = await chatAnswer(
        streamingEnv("unused", "off"),
        repo,
        "Why?",
        `stream-${crypto.randomUUID()}`,
        () => {},
        [],
        "tester",
        (t) => deltas.push(t),
      );
      expect(off.text).toContain("Non-streamed answer.");
      expect(calls.at(-1)).not.toHaveProperty("stream");
      expect(calls.at(-1)).toHaveProperty("response_format");
      await closeAll(repo, "stream-close");
    });
  });
});
