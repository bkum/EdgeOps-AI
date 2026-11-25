import { z } from "zod";
import { Operations } from "./operations";
import { boundedJson, safeText } from "./sanitize";
import type { Env } from "./types";
import type { Integration } from "./contracts";

const safeReasons = [
  "disabled",
  "credential_missing",
  "resource_not_approved",
  "rate_limited",
  "denied",
  "provider_unavailable",
  "provider_request_budget",
  "response_too_large",
  "empty_response",
  "resource_mismatch",
  "partial_provider_response",
];

const metric = z.object({
  sum: z.object({
    requests: z.number().nonnegative(),
    errors: z.number().nonnegative(),
    subrequests: z.number().nonnegative().optional(),
  }),
  dimensions: z
    .object({
      datetime: z.string(),
      scriptName: z.string(),
      status: z.string(),
    })
    .optional(),
});
export function normalizeMetrics(raw: unknown, worker: string) {
  const body = z
    .object({
      data: z.object({
        viewer: z.object({
          accounts: z.array(
            z.object({ workersInvocationsAdaptive: z.array(metric).max(100) }),
          ),
        }),
      }),
      errors: z.unknown().optional(),
    })
    .parse(raw);
  if (
    (Array.isArray(body.errors) ? body.errors.length > 0 : !!body.errors) ||
    body.data.viewer.accounts.length !== 1
  )
    throw new Error("partial_provider_response");
  const rows = body.data.viewer.accounts[0].workersInvocationsAdaptive;
  if (rows.some((r) => r.dimensions && r.dimensions.scriptName !== worker))
    throw new Error("resource_mismatch");
  return {
    requests: rows.reduce((s, r) => s + r.sum.requests, 0),
    errors: rows.reduce((s, r) => s + r.sum.errors, 0),
    coverage: "sampled",
    rows: rows.length,
    truncated: rows.length === 100,
    cpuTimeIsNotResponseLatency: true,
  };
}
export function normalizeLogs(raw: unknown, worker: string) {
  const body = z
    .object({
      result: z
        .object({
          events: z
            .object({
              events: z
                .array(
                  z
                    .object({
                      timestamp: z.number(),
                      $workers: z
                        .object({
                          scriptName: z.string(),
                          outcome: z.string().optional(),
                          cpuTimeMs: z.number().optional(),
                          wallTimeMs: z.number().optional(),
                        })
                        .passthrough(),
                    })
                    .passthrough(),
                )
                .max(100),
            })
            .optional(),
        })
        .passthrough(),
    })
    .parse(raw);
  const events = body.result.events?.events ?? [];
  if (events.some((e) => e.$workers.scriptName !== worker))
    throw new Error("resource_mismatch");
  // Deliberately drop source, URLs, identifiers, user console strings, request headers and metadata.
  return events.map((e) => ({
    timestamp: new Date(e.timestamp).toISOString(),
    outcome: ["ok", "exception", "exceededCpu", "canceled", "unknown"].includes(
      e.$workers.outcome ?? "",
    )
      ? e.$workers.outcome
      : "unknown",
    cpuTimeMs: e.$workers.cpuTimeMs,
    wallTimeMs: e.$workers.wallTimeMs,
  }));
}
export async function syncIntegration(
  env: Env,
  repo: Operations,
  integration: Integration,
  fetcher: typeof fetch = fetch,
) {
  const config = JSON.parse(integration.config) as {
    accountId?: string;
    workerName?: string;
    repository?: string;
    environment?: string;
    projectRef?: string;
  };
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 3600000).toISOString();
  const output: { kind: string; data: unknown; status: string }[] = [];
  let requests = 0;
  const request = async (url: string, init: RequestInit = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++requests > 10) throw new Error("provider_request_budget");
      const response = await fetcher(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        // Retry-After in seconds (including 0); a missing or date-form value waits 1 s.
        const seconds = Number(response.headers.get("retry-after") ?? "1");
        const delay = Math.min(
          2000,
          Math.max(100, Number.isFinite(seconds) ? seconds * 1000 : 1000),
        );
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      return boundedJson(response, 32768);
    }
    throw new Error("provider_unavailable");
  };
  try {
    if (!integration.enabled) throw new Error("disabled");
    const allowed = JSON.parse(env.PROVIDER_RESOURCES ?? "[]") as {
      scope: string;
      provider: string;
      resource: string;
    }[];
    const resource =
      integration.provider === "cloudflare"
        ? `${config.accountId}/${config.workerName}`
        : integration.provider === "github"
          ? config.repository
          : config.projectRef;
    if (
      !allowed.some(
        (a) =>
          a.scope === repo.scope &&
          a.provider === integration.provider &&
          a.resource === resource,
      )
    )
      throw new Error("resource_not_approved");
    if (integration.provider === "cloudflare") {
      if (!env.CLOUDFLARE_TELEMETRY_TOKEN)
        throw new Error("credential_missing");
      const headers = {
        Authorization: `Bearer ${env.CLOUDFLARE_TELEMETRY_TOKEN}`,
        "Content-Type": "application/json",
      };
      const raw = await request(
        "https://api.cloudflare.com/client/v4/graphql",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            query:
              "query($accountTag:string,$start:string,$end:string,$script:string){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsAdaptive(limit:100,filter:{scriptName:$script,datetime_geq:$start,datetime_leq:$end}){sum{requests errors subrequests} dimensions{datetime scriptName status}}}}}",
            variables: {
              accountTag: config.accountId,
              start: since,
              end: now,
              script: config.workerName,
            },
          }),
        },
      );
      output.push({
        kind: "metrics",
        data: normalizeMetrics(raw, config.workerName!),
        status: "partial",
      });
      try {
        const logs = await request(
          `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/observability/telemetry/query`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              queryId: "edgeops-readonly",
              timeframe: { from: Date.now() - 3600000, to: Date.now() },
              view: "events",
              limit: 100,
              datasets: ["cloudflare-workers"],
              filterCombination: "and",
              filters: [
                {
                  key: "$workers.scriptName",
                  operation: "eq",
                  type: "string",
                  value: config.workerName,
                },
              ],
            }),
          },
        );
        output.push({
          kind: "logs",
          data: normalizeLogs(logs, config.workerName!),
          status: "partial",
        });
      } catch {
        output.push({
          kind: "logs",
          data: {
            gap: "Worker logs unavailable or schema/permissions unsupported",
          },
          status: "unavailable",
        });
      }
    } else if (integration.provider === "github") {
      if (!env.GITHUB_READ_TOKEN) throw new Error("credential_missing");
      const headers = {
        Authorization: `Bearer ${env.GITHUB_READ_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "EdgeOps-readonly",
      };
      const url = `https://api.github.com/repos/${config.repository}/deployments?per_page=20${config.environment ? "&environment=" + encodeURIComponent(config.environment) : ""}`;
      const deployments = z
        .array(
          z.object({
            id: z.number(),
            sha: z.string().regex(/^[a-f0-9]{40}$/),
            environment: z.string(),
            created_at: z.iso.datetime(),
          }),
        )
        .max(20)
        .parse(await request(url, { headers }));
      const normalized = [];
      for (const deployment of deployments.slice(0, 5)) {
        const statuses = z
          .array(
            z.object({
              state: z.enum([
                "error",
                "failure",
                "pending",
                "in_progress",
                "queued",
                "success",
                "inactive",
              ]),
              created_at: z.iso.datetime(),
            }),
          )
          .parse(
            await request(
              `https://api.github.com/repos/${config.repository}/deployments/${deployment.id}/statuses?per_page=1`,
              { headers },
            ),
          );
        normalized.push({
          revision: deployment.sha,
          environment: safeText(deployment.environment, 80),
          createdAt: deployment.created_at,
          state: statuses[0]?.state ?? "unknown",
        });
      }
      output.push({
        kind: "deployments",
        data: {
          deployments: normalized,
          coverage: "latest_5_of_20",
          causality: "unconfirmed",
        },
        status: "partial",
      });
    } else {
      if (!env.SUPABASE_READ_TOKEN) throw new Error("credential_missing");
      // Management health only: no database SQL, table access, auth-user data or service-role key.
      const health = z
        .array(
          z.object({
            name: z.string(),
            healthy: z.boolean().optional(),
            status: z.string().optional(),
          }),
        )
        .max(20)
        .parse(
          await request(
            `https://api.supabase.com/v1/projects/${config.projectRef}/health?services=db,auth`,
            { headers: { Authorization: `Bearer ${env.SUPABASE_READ_TOKEN}` } },
          ),
        );
      output.push({
        kind: "database-health",
        data: health.map((h) => ({
          service: safeText(h.name, 40),
          healthy: h.healthy ?? null,
          status:
            h.status &&
            [
              "ACTIVE_HEALTHY",
              "ACTIVE_UNHEALTHY",
              "INACTIVE",
              "UNKNOWN",
            ].includes(h.status)
              ? h.status
              : "unknown",
        })),
        status: "partial",
      });
    }
    // Deterministic IDs per minute and position: a retried Workflow step or a repeated
    // sync in the same minute replaces its rows instead of duplicating them.
    const bucket = Math.floor(Date.now() / 60000);
    await repo.db.batch(
      output.map((item, index) =>
        repo.stmt(
          "INSERT OR REPLACE INTO telemetry VALUES(?,?,?,?,?,?,?,?,?,?)",
          `${integration.provider}-${integration.service_id}-${bucket}-${index}-${item.kind}`,
          integration.service_id,
          integration.provider,
          item.kind,
          item.status,
          JSON.stringify(item.data),
          now,
          now,
          new Date(Date.now() + 3600000).toISOString(),
        ),
      ),
    );
    await repo
      .stmt(
        "UPDATE integrations SET status=?2,last_checked_at=?3,safe_error=NULL WHERE scope=?1 AND provider=?4 AND service_id=?5",
        output.every((o) => o.status !== "unavailable")
          ? "verified"
          : "partial",
        now,
        integration.provider,
        integration.service_id,
      )
      .run();
    await repo.audit("provider", "integration.sync", "ok");
    return { status: "ok", items: output.length };
  } catch (error) {
    // Only fixed reason codes are stored; provider messages never reach D1 or the UI.
    const reason =
      error instanceof z.ZodError || error instanceof SyntaxError
        ? "schema_mismatch"
        : error instanceof Error && safeReasons.includes(error.message)
          ? error.message
          : "provider_unavailable";
    await repo
      .stmt(
        "UPDATE integrations SET status=?2,last_checked_at=?3,safe_error=?4 WHERE scope=?1 AND provider=?5 AND service_id=?6",
        "unavailable",
        now,
        reason,
        integration.provider,
        integration.service_id,
      )
      .run();
    await repo.audit("provider", "integration.sync", reason);
    return { status: "unavailable", reason };
  }
}
