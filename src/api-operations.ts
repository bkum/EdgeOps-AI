import { Hono } from "hono";
import { z } from "zod";
import { Operations } from "./operations";
import {
  environmentSchema,
  serviceSchema,
  operatorSchema,
  requestKey,
  knowledgeSchema,
  integrationSchema,
  settingsSchema,
  recommendationDispositionSchema,
} from "./contracts";
import { pageQuerySchema, type PageKind } from "./pagination";
import { destinationsStatus } from "./notify";
import { approvedURL, runMonitor } from "./probes";
import { syncIntegration } from "./providers";
import type { Env, Principal } from "./types";
import { reconcile } from "./dispatch";
import { mayUseScope } from "./auth";
import { apiError } from "./http";
import { deploymentComparisons } from "./deployments";
export const operationsApi = new Hono<{
  Bindings: Env;
  Variables: { principal: Principal; requestId: string };
}>();
const repo = (c: { env: Env; get: (k: "principal") => Principal }) =>
  new Operations(c.env.DB, c.get("principal").scope);
const data = (value: unknown) => ({ data: value });
// `data` stays the array of items; `meta.nextCursor` is set when more rows exist.
const listed = async (
  c: { env: Env; get: (k: "principal") => Principal; req: { query: () => Record<string, string> } },
  kind: PageKind,
) => {
  const page = await repo(c).page(kind, pageQuerySchema.parse(c.req.query()));
  return { data: page.items, meta: { nextCursor: page.nextCursor } };
};

async function invalidateConversations(env: Env, scope: string) {
  const records = (
    await new Operations(env.DB, scope)
      .stmt("SELECT agent_name FROM conversations WHERE scope=? LIMIT 100")
      .all<{ agent_name: string }>()
  ).results;
  for (const record of records) {
    const stub = env.ASSISTANT.get(env.ASSISTANT.idFromName(record.agent_name));
    await stub.fetch(
      new Request("https://agent.internal/conversation", {
        method: "DELETE",
        headers: { "x-ops-scope": scope },
      }),
    );
  }
}
operationsApi.get("/scopes", async (c) => {
  const principal = c.get("principal");
  const scopes = (await repo(c).scopes()) as { scope: string }[];
  return c.json(data(scopes.filter((s) => mayUseScope(principal, s.scope))));
});
operationsApi.post("/scopes", async (c) => {
  const principal = c.get("principal");
  const input = environmentSchema.parse(await c.req.json());
  // Only operators granted every environment may register new ones.
  if (principal.scopes !== "*")
    return c.json(
      {
        error: {
          code: "forbidden",
          message: "Registering environments requires access to all environments",
          retryable: false,
        },
        requestId: c.get("requestId"),
      },
      403,
    );
  // A private (live) deployment never hosts synthetic demo environments.
  if (c.env.MODE === "private" && input.mode === "demo")
    return c.json(
      {
        error: {
          code: "validation_failed",
          message: "Demo environments belong in a separate demo deployment",
          retryable: false,
        },
        requestId: c.get("requestId"),
      },
      422,
    );
  return c.json(data(await repo(c).createScope(input, principal.actor)), 201);
});
operationsApi.get("/services", async (c) =>
  c.json(data(await repo(c).services())),
);
operationsApi.post("/services", async (c) => {
  const input = serviceSchema.parse(await c.req.json());
  const r = repo(c);
  const environment = await r
    .stmt("SELECT mode FROM environments WHERE scope=?")
    .first<{ mode: string }>();
  if (input.kind === "synthetic" && environment?.mode !== "demo")
    return apiError(
      c,
      422,
      "validation_failed",
      "Synthetic probes are restricted to demo scopes",
    );
  if (input.kind === "http") approvedURL(input.targetUrl!, c.env, r.scope);
  return c.json(
    data(await r.saveService(input, c.get("principal").actor)),
    201,
  );
});
operationsApi.post("/services/:id/probes", async (c) => {
  const key = requestKey.parse(c.req.header("idempotency-key"));
  z.object({})
    .strict()
    .parse(await c.req.json());
  const r = repo(c);
  if (
    !(await r
      .stmt("SELECT id FROM services WHERE scope=? AND id=?", c.req.param("id"))
      .first())
  )
    return c.notFound();
  // API-controlled minute lease bounds live egress; idempotent replay reads stored results.
  const existing = await r
    .stmt(
      "SELECT service_id FROM scenario_runs WHERE scope=? AND request_key=?",
      key,
    )
    .first<{ service_id: string }>();
  if (existing && existing.service_id !== c.req.param("id"))
    return apiError(c, 409, "idempotency_conflict", "Idempotency conflict");
  if (existing) return c.json(data({ status: "already_recorded" }));
  const tick = Math.floor(Date.now() / 60000);
  const lease = await r
    .stmt(
      "INSERT OR IGNORE INTO scheduler_leases VALUES(?,?,?,?)",
      `manual-${c.req.param("id")}`,
      tick,
      new Date().toISOString(),
    )
    .run();
  if (!lease.meta.changes)
    return apiError(
      c,
      429,
      "rate_limited",
      "One manual probe per service per minute",
      true,
    );
  const result = await runMonitor(
    c.env,
    r.scope,
    c.req.param("id"),
    key,
    c.get("principal").actor,
  );
  c.executionCtx.waitUntil(reconcile(c.env, r.scope));
  return c.json(data(result), 202);
});
operationsApi.post("/incidents/:id/operator-actions", async (c) => {
  const input = operatorSchema.parse(await c.req.json());
  const key = requestKey.parse(c.req.header("idempotency-key"));
  const result = await repo(c).operator(
    c.req.param("id"),
    key,
    input,
    c.get("principal").actor,
  );
  if (input.action === "retry")
    c.executionCtx.waitUntil(reconcile(c.env, c.get("principal").scope));
  return result ? c.json(data(result)) : c.notFound();
});
operationsApi.get("/incidents", async (c) => c.json(await listed(c, "incidents")));
operationsApi.get("/incidents/:id/recommendations", async (c) =>
  (await repo(c).incident(c.req.param("id")))
    ? c.json(data(await repo(c).recommendations(c.req.param("id"))))
    : c.notFound(),
);
operationsApi.patch("/incidents/:id/recommendations/:recommendationId", async (c) => {
  const input = recommendationDispositionSchema.parse(await c.req.json());
  return c.json(
    data(
      await repo(c).disposeRecommendation(
        c.req.param("id"),
        c.req.param("recommendationId"),
        input,
        c.get("principal").actor,
      ),
    ),
  );
});
operationsApi.get("/incidents/:id/events", async (c) =>
  (await repo(c).incident(c.req.param("id")))
    ? c.json(data(await repo(c).events(c.req.param("id"))))
    : c.notFound(),
);
operationsApi.get("/knowledge", async (c) => c.json(await listed(c, "knowledge")));
operationsApi.patch("/knowledge/:id", async (c) => {
  const input = knowledgeSchema.parse(await c.req.json());
  await repo(c).updateMemory(
    c.req.param("id"),
    input.expectedVersion,
    input.content,
    c.get("principal").actor,
  );
  await invalidateConversations(c.env, c.get("principal").scope);
  return c.json(data({ updated: true }));
});
operationsApi.delete("/knowledge/:id", async (c) => {
  const input = z
    .object({ expectedVersion: z.number().int().positive() })
    .strict()
    .parse(await c.req.json());
  await repo(c).updateMemory(
    c.req.param("id"),
    input.expectedVersion,
    null,
    c.get("principal").actor,
  );
  await invalidateConversations(c.env, c.get("principal").scope);
  return c.json(data({ deleted: true }));
});
operationsApi.get("/integrations", async (c) =>
  c.json(
    data(
      (await repo(c).integrations()).map((i) => ({
        ...i,
        credentialsConfigured:
          i.provider === "cloudflare"
            ? !!c.env.CLOUDFLARE_TELEMETRY_TOKEN
            : i.provider === "github"
              ? !!c.env.GITHUB_READ_TOKEN
              : !!c.env.SUPABASE_READ_TOKEN,
      })),
    ),
  ),
);
operationsApi.post("/integrations", async (c) => {
  await repo(c).saveIntegration(
    integrationSchema.parse(await c.req.json()),
    c.get("principal").actor,
  );
  return c.json(data({ saved: true }));
});
operationsApi.post("/integrations/:provider/:serviceId/sync", async (c) => {
  z.object({})
    .strict()
    .parse(await c.req.json());
  const r = repo(c);
  const integration = (await r.integrations()).find(
    (i) =>
      i.provider === c.req.param("provider") &&
      i.service_id === c.req.param("serviceId"),
  );
  if (!integration) return c.notFound();
  const recent =
    integration.last_checked_at &&
    Date.now() - Date.parse(integration.last_checked_at) < 60000;
  if (recent)
    return c.json(
      {
        error: {
          code: "rate_limited",
          message: "Integration refresh limited to once per minute",
          retryable: true,
        },
        requestId: c.get("requestId"),
      },
      429,
    );
  return c.json(data(await syncIntegration(c.env, r, integration)));
});
operationsApi.get("/telemetry", async (c) => c.json(await listed(c, "telemetry")));
operationsApi.get("/deployments/comparisons", async (c) =>
  c.json(data(await deploymentComparisons(repo(c)))),
);
operationsApi.get("/usage", async (c) =>
  c.json(data(await repo(c).usage(c.env))),
);
operationsApi.get("/settings", async (c) =>
  c.json(data(await repo(c).settings())),
);
operationsApi.patch("/settings", async (c) => {
  await repo(c).saveSettings(
    settingsSchema.parse(await c.req.json()),
    c.get("principal").actor,
  );
  return c.json(data({ saved: true }));
});
operationsApi.get("/notifications", async (c) => c.json(await listed(c, "notifications")));
// Configured external destinations, by host only: webhook URLs are credentials.
operationsApi.get("/notifications/destinations", async (c) =>
  c.json(data(await destinationsStatus(c.env, repo(c)))),
);
operationsApi.post("/notifications/:id/read", async (c) => {
  z.object({})
    .strict()
    .parse(await c.req.json());
  return c.json(data(await repo(c).markNotificationRead(c.req.param("id"))));
});
operationsApi.get("/audit", async (c) => {
  const page = await listed(c, "audit");
  // The row ID is only the cursor key; the response shape is unchanged.
  return c.json({ ...page, data: page.data.map(({ id: _, ...row }) => row) });
});
operationsApi.get("/export", async (c) => {
  const r = repo(c);
  await r.audit(c.get("principal").actor, "scope.export", "ok");
  return c.json(
    data({
      scope: r.scope,
      exportedAt: new Date().toISOString(),
      ...(await r.exportScope()),
    }),
  );
});
operationsApi.post("/retention/run", async (c) => {
  z.object({})
    .strict()
    .parse(await c.req.json());
  await repo(c).purge();
  return c.json(data({ purged: true }));
});
