import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { authenticate, mayUseScope } from "./auth";
import { questionSchema, scenarioSchema } from "./domain";
import { demoRunSchema } from "./contracts";
import { Operations } from "./operations";
import { operationsApi } from "./api-operations";
import { schedule } from "./probes";
import { Conflict, Repository } from "./repository";
import { reconcile } from "./dispatch";
import { SCOPE, type Env, type Principal } from "./types";
export { InvestigationWorkflow } from "./workflow";
export { OpsAgent } from "./agent";

const app = new Hono<{
  Bindings: Env;
  Variables: { principal: Principal; requestId: string };
}>();
const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
// Headers set with c.header() before next() are lost when a handler returns a raw
// Response (static assets, agent SSE), so apply them to the final response instead.
function withHeaders(response: Response, headers: Record<string, string>) {
  if (response.status === 101) return response;
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers))
    copy.headers.set(name, value);
  return copy;
}
app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.res = withHeaders(c.res, securityHeaders);
});
app.use("/api/*", bodyLimit({ maxSize: 8192 }));
app.use("/api/*", async (c, next) => {
  await next();
  c.res = withHeaders(c.res, { "Cache-Control": "no-store" });
});
app.use("/api/*", async (c, next) => {
  const principal = await authenticate(c.req.raw, c.env);
  if (!principal)
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Authentication required",
          retryable: false,
        },
        requestId: c.get("requestId"),
      },
      401,
    );
  const selected = c.req.header("x-edgeops-scope") ?? principal.scope;
  // Listing environments only returns the principal's own grants, so it must work
  // before a permitted scope is selected (e.g. a restricted operator's first load).
  const listing = c.req.method === "GET" && c.req.path === "/api/v1/scopes";
  if (
    !/^[a-zA-Z0-9_-]{1,80}\/[a-zA-Z0-9_-]{1,80}$/.test(selected) ||
    ((!(await new Operations(c.env.DB, selected).authorizeScope()) ||
      !mayUseScope(principal, selected)) &&
      !listing)
  )
    return c.notFound();
  c.set("principal", { ...principal, scope: selected });
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    const expected = new URL(c.req.url).origin;
    // CLI bearer requests may omit Origin; cookie-backed browser requests cannot omit it.
    if (
      (origin &&
        origin !== expected &&
        !(
          c.env.MODE === "development" && origin === "http://127.0.0.1:5173"
        )) ||
      (!origin && !c.req.header("authorization"))
    ) {
      return c.json(
        {
          error: {
            code: "origin_denied",
            message: "Same origin required",
            retryable: false,
          },
          requestId: c.get("requestId"),
        },
        403,
      );
    }
    if (!c.req.header("content-type")?.startsWith("application/json"))
      return c.json(
        {
          error: {
            code: "invalid_content_type",
            message: "Use application/json",
            retryable: false,
          },
          requestId: c.get("requestId"),
        },
        422,
      );
  }
  await next();
});
const repo = (c: { env: Env; get: (key: "principal") => Principal }) =>
  new Operations(c.env.DB, c.get("principal").scope);
app.get("/api/v1/overview", async (c) => {
  const r = repo(c);
  const [view, services, notifications, telemetry] = await Promise.all([
    r.overview(),
    r.services(),
    r.notifications(),
    r.telemetry("metrics"),
  ]);
  const latestByResource = new Map<string, (typeof telemetry)[number]>();
  for (const t of telemetry) {
    const key = String(t.provider) + "/" + String(t.service_id);
    if (
      Date.parse(String(t.expires_at)) > Date.now() &&
      !latestByResource.has(key)
    )
      latestByResource.set(key, t);
  }
  const fresh = [...latestByResource.values()];
  const metrics = fresh.map((t) => ({
    serviceId: t.service_id,
    provider: t.provider,
    status: t.status,
    observedAt: t.observed_at,
    fetchedAt: t.fetched_at,
    ...JSON.parse(String(t.summary)),
  }));
  const health = services.some((s) => s.health === "unhealthy")
    ? "unhealthy"
    : services.length && services.every((s) => s.health === "healthy")
      ? "healthy"
      : "unknown";
  return c.json({
    data: {
      ...view,
      health,
      services,
      notifications,
      metrics,
      mode: c.env.MODE,
      aiMode: c.env.AI_MODE,
      scope: c.get("principal").scope,
    },
    meta: { requestId: c.get("requestId") },
  });
});
app.post("/api/v1/demo/scenarios/:scenario/runs", async (c) => {
  // Synthetic scenario execution is restricted to authenticated local demo scopes.
  if (c.env.MODE !== "development") return c.notFound();
  const scenario = scenarioSchema.parse(c.req.param("scenario"));
  const key = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{8,80}$/)
    .parse(c.req.header("idempotency-key"));
  const body = demoRunSchema.parse(await c.req.json());
  const environment = await repo(c)
    .stmt("SELECT mode FROM environments WHERE scope=?")
    .first<{ mode: string }>();
  if (environment?.mode !== "demo") return c.notFound();
  const serviceId = body.serviceId ?? "demo-api";
  const monitor = await repo(c)
    .stmt("SELECT kind FROM monitors WHERE scope=? AND service_id=?", serviceId)
    .first<{ kind: string }>();
  if (monitor?.kind !== "synthetic") return c.notFound();
  const data = await repo(c).scenario(
    scenario,
    key,
    c.get("principal").actor,
    serviceId,
  );
  await repo(c).verificationFailed(serviceId, data.health, key);
  c.executionCtx.waitUntil(reconcile(c.env, c.get("principal").scope));
  return c.json({ data, meta: { requestId: c.get("requestId") } }, 202);
});
app.get("/api/v1/incidents/:id", async (c) => {
  const r = repo(c);
  const raw = await r.incident(c.req.param("id"));
  const data = raw
    ? {
        ...raw,
        events: await r.events(c.req.param("id")),
        recovered: await r.recovered(
          c.req.param("id"),
          raw.incident.service_id,
        ),
      }
    : null;
  return data
    ? c.json({ data, meta: { requestId: c.get("requestId") } })
    : c.notFound();
});
app.on(["GET", "POST", "DELETE"], "/api/v1/assistant", async (c) => {
  const body =
    c.req.method === "POST" ? questionSchema.parse(await c.req.json()) : null;
  if (c.req.method === "DELETE")
    z.object({})
      .strict()
      .parse(await c.req.json());
  const conversationId = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .parse(body?.conversationId ?? c.req.query("conversationId") ?? "default");
  const principal = c.get("principal");
  const name = JSON.stringify([
    principal.scope,
    principal.actor,
    conversationId,
  ]);
  const r = repo(c);
  const now = new Date().toISOString();
  // Only asking a question registers a conversation (and refreshes its activity), so
  // reads cannot consume the per-actor cap; inactive registrations expire on schedule.
  if (c.req.method === "POST")
    await c.env.DB.batch([
      r.stmt(
        "INSERT OR IGNORE INTO conversations(scope,id,agent_name,actor,created_at,last_used_at) SELECT ?1,?2,?3,?4,?5,?5 WHERE (SELECT COUNT(*) FROM conversations WHERE scope=?1 AND actor=?4)<20",
        conversationId,
        name,
        principal.actor,
        now,
      ),
      r.stmt(
        "UPDATE conversations SET last_used_at=?4 WHERE scope=?1 AND id=?2 AND actor=?3",
        conversationId,
        principal.actor,
        now,
      ),
    ]);
  const registered = await r
    .stmt(
      "SELECT id FROM conversations WHERE scope=? AND id=? AND actor=?",
      conversationId,
      principal.actor,
    )
    .first();
  if (!registered && c.req.method !== "POST")
    return c.json({ messages: [] });
  if (!registered)
    return c.json(
      {
        error: {
          code: "conversation_limit",
          message: "Conversation limit reached for this environment",
          retryable: false,
        },
        requestId: c.get("requestId"),
      },
      429,
    );
  const stub = c.env.ASSISTANT.get(c.env.ASSISTANT.idFromName(name));
  if (c.req.method === "DELETE") {
    const cleared = await stub.fetch(
      new Request("https://agent.internal/conversation", {
        method: "DELETE",
        headers: { "x-ops-scope": principal.scope },
      }),
    );
    if (cleared.ok)
      await r
        .stmt(
          "DELETE FROM conversations WHERE scope=? AND id=? AND actor=?",
          conversationId,
          principal.actor,
        )
        .run();
    return cleared;
  }
  return stub.fetch(
    new Request("https://agent.internal/conversation", {
      method: c.req.method,
      headers: {
        "content-type": "application/json",
        "x-ops-scope": principal.scope,
        "x-ops-actor": principal.actor,
      },
      body: body ? JSON.stringify({ question: body.question }) : undefined,
    }),
  );
});
app.route("/api/v1", operationsApi);
app.all("/api/*", (c) => c.notFound());
app.all("/agents/*", (c) => c.notFound());
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  const validation =
    error instanceof z.ZodError || error instanceof SyntaxError;
  const conflict = error instanceof Conflict;
  return c.json(
    {
      error: {
        code: validation ? "validation" : conflict ? "conflict" : "unavailable",
        message: validation
          ? "Invalid request"
          : conflict
            ? error.message
            : "Dependency unavailable",
        retryable: !validation && !conflict,
      },
      requestId: c.get("requestId"),
    },
    validation ? 422 : conflict ? 409 : 503,
  );
});

export { app };
export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(schedule(env, event.scheduledTime));
  },
};
