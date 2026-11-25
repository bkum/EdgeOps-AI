import { z } from "zod";
import { boundedJson } from "./sanitize";
import { Operations } from "./operations";
import { reconcile, reconcileStalled } from "./dispatch";
import { samplesFor } from "./fixtures";
import { syncIntegration } from "./providers";
import { deliverNotifications } from "./notify";
import type { Env } from "./types";
import type { Monitor } from "./contracts";

export function approvedURL(
  raw: string,
  env: Pick<Env, "PROBE_ALLOWLIST">,
  scope: string,
): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.hostname.length > 253 ||
    !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(url.hostname) ||
    /\.(local|internal|localhost|test|invalid)$/.test(url.hostname)
  )
    throw new Error("target_denied");
  const entries = z
    .array(z.object({ scope: z.string(), url: z.string() }))
    .parse(JSON.parse(env.PROBE_ALLOWLIST ?? "[]"));
  if (!entries.some((e) => e.scope === scope && e.url === url.href))
    throw new Error("target_not_approved");
  return url;
}
export function publicIPv4(value: string) {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
  )
    return false;
  const [a, b, c] = parts.map(Number);
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0 || b === 2)) &&
    !(a === 192 && b === 88 && c === 99) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  );
}
// Only global unicast (2000::/3) is public; documentation, Teredo and 6to4 prefixes
// can embed or stand in for private IPv4 destinations.
export function publicIPv6(value: string) {
  const address = value.toLowerCase();
  if (!/^[23][0-9a-f]{0,3}:/.test(address)) return false;
  const [first, second = ""] = address.split(":");
  const head = parseInt(first.padStart(4, "0"), 16);
  const next = second === "" ? 0 : parseInt(second, 16);
  if (head === 0x2002) return false; // 6to4
  if (head === 0x2001 && next === 0) return false; // Teredo 2001:0::/32
  if (head === 0x2001 && next === 0xdb8) return false; // documentation
  if (head === 0x3fff && next <= 0x0fff) return false; // documentation 3fff::/20
  return true;
}
export async function validateDNS(hostname: string, fetcher: typeof fetch) {
  // Reject private resolutions. Only operator-owned immutable URL allowlists are permitted;
  // production Worker must be originless (no same-zone origin route/private service binding).
  for (const type of ["A", "AAAA"]) {
    const result = (await boundedJson(
      await fetcher(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        {
          headers: { accept: "application/dns-json" },
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        },
      ),
      16384,
    )) as { Status?: number; Answer?: { type: number; data: string }[] };
    if (result.Status !== 0) throw new Error("dns_unavailable");
    const addresses = (result.Answer ?? []).filter(
      (a) => a.type === 1 || a.type === 28,
    );
    if (
      addresses.some((a) =>
        a.type === 1
          ? !publicIPv4(a.data)
          : !publicIPv6(a.data),
      )
    )
      throw new Error("private_resolution");
    if (type === "A" && !addresses.some((a) => a.type === 1))
      throw new Error("dns_unavailable");
  }
}
export async function probeHTTP(
  m: Monitor,
  env: Env,
  scope: string,
  fetcher: typeof fetch = fetch,
) {
  const observedAt = new Date().toISOString(),
    start = Date.now();
  let phase = "policy";
  try {
    const url = approvedURL(m.target_url ?? "", env, scope);
    phase = "dns";
    await validateDNS(url.hostname, fetcher);
    phase = "http";
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "EdgeOps-ReadOnly-Probe/1.0",
        Accept: "application/json,text/plain;q=0.5",
      },
      cache: "no-store",
    });
    const latencyMs = Math.min(60000, Date.now() - start);
    const httpStatus = response.status;
    // No response body is consumed or persisted: no tokens/customer payloads enter telemetry.
    await response.body?.cancel();
    const status =
      httpStatus === m.expected_status && latencyMs <= m.slow_ms
        ? "healthy"
        : "unhealthy";
    return {
      observedAt,
      status,
      latencyMs,
      httpStatus,
      category:
        httpStatus >= 300 && httpStatus < 400
          ? "redirect_denied"
          : httpStatus !== m.expected_status
            ? "http_status"
            : latencyMs > m.slow_ms
              ? "latency"
              : "ok",
    } as const;
  } catch (error) {
    const category =
      error instanceof Error &&
      [
        "target_denied",
        "target_not_approved",
        "private_resolution",
        "dns_unavailable",
      ].includes(error.message)
        ? error.message
        : `transport_unavailable_${phase}_${error instanceof Error ? error.name : "unknown"}`;
    return {
      observedAt,
      status: phase === "http" ? ("unhealthy" as const) : ("unknown" as const),
      latencyMs: Math.min(60000, Date.now() - start),
      category,
    };
  }
}
export async function runMonitor(
  env: Env,
  scope: string,
  serviceId: string,
  key: string,
  actor: string,
  fetcher: typeof fetch = fetch,
) {
  const repo = new Operations(env.DB, scope);
  const monitor = await repo
    .stmt("SELECT * FROM monitors WHERE scope=? AND service_id=?", serviceId)
    .first<Monitor>();
  if (!monitor) throw new Error("service_unavailable");
  const samples =
    monitor.kind === "http"
      ? [await probeHTTP(monitor, env, scope, fetcher)]
      : samplesFor(monitor.scenario as Parameters<typeof samplesFor>[0]).map(
          (s, i) => ({
            ...s,
            observedAt: new Date(Date.now() + i).toISOString(),
          }),
        );
  const result = await repo.recordSamples(
    serviceId,
    monitor.kind === "http" ? "http" : monitor.scenario,
    samples,
    key,
    actor,
  );
  await repo.verificationFailed(
    serviceId,
    samples.some((s) => s.status === "unhealthy") ? "unhealthy" : result.health,
    key,
  );
  return { ...result, probe: samples.at(-1) };
}
// Cron fires at most every five minutes with small start jitter. A monitor is due
// slightly before its exact interval (min(60s, 20%) slack) so a run that started a
// few seconds later than the previous one does not skip a whole cycle. The interval
// lease below still prevents two runs in the same interval tick.
// Inactive conversations past retention free their slot: clear the agent's messages
// first, then the registration, so no unmaintained history is left behind.
export async function expireConversations(env: Env, repo: Operations) {
  const settings = await repo
    .stmt("SELECT retention_days FROM settings WHERE scope=?")
    .first<{ retention_days: number }>();
  const cutoff = new Date(
    Date.now() - (settings?.retention_days ?? 30) * 86400000,
  ).toISOString();
  const expired = (
    await repo
      .stmt(
        "SELECT id,actor,agent_name FROM conversations WHERE scope=? AND COALESCE(last_used_at,created_at)<? ORDER BY COALESCE(last_used_at,created_at) LIMIT 20",
        cutoff,
      )
      .all<{ id: string; actor: string; agent_name: string }>()
  ).results;
  for (const conversation of expired) {
    try {
      const cleared = await env.ASSISTANT.get(
        env.ASSISTANT.idFromName(conversation.agent_name),
      ).fetch(
        new Request("https://agent.internal/conversation", {
          method: "DELETE",
          headers: { "x-ops-scope": repo.scope },
        }),
      );
      if (!cleared.ok) continue;
      await repo
        .stmt(
          "DELETE FROM conversations WHERE scope=? AND id=? AND actor=? AND COALESCE(last_used_at,created_at)<?",
          conversation.id,
          conversation.actor,
          cutoff,
        )
        .run();
    } catch {
      await repo.audit("scheduler", "conversation.expire", "unavailable");
    }
  }
}
export async function schedule(env: Env, scheduledTime = Date.now()) {
  const scopes = (await new Operations(env.DB, "synthetic/demo").scopes()) as {
    scope: string;
    mode: string;
  }[];
  const now = new Date(scheduledTime).toISOString();
  const monitors = (
    await env.DB.prepare(
      `SELECT m.* FROM monitors m JOIN environments e ON e.scope=m.scope JOIN applications a ON a.id=e.application_id WHERE a.workspace_id='default' AND m.enabled=1 AND (m.last_scheduled_at IS NULL OR julianday(m.last_scheduled_at)+(m.interval_seconds-min(60,m.interval_seconds*0.2))/86400.0<=julianday(?)) ORDER BY m.last_scheduled_at ASC,m.scope,m.service_id LIMIT 20`,
    )
      .bind(now)
      .all<Monitor>()
  ).results;
  // Up to four probes at a time keeps a full batch well inside one Cron interval.
  await pool(monitors, 4, async (m) => {
    const repo = new Operations(env.DB, m.scope),
      tick = Math.floor(scheduledTime / (m.interval_seconds * 1000));
    const lease = await repo
      .stmt(
        "INSERT OR IGNORE INTO scheduler_leases VALUES(?,?,?,?)",
        m.service_id,
        tick,
        new Date().toISOString(),
      )
      .run();
    if (!lease.meta.changes) return;
    // Record the run's start (not its finish) so probe duration never delays the next cycle.
    await repo
      .stmt(
        "UPDATE monitors SET last_scheduled_at=?2 WHERE scope=?1 AND service_id=?3",
        now,
        m.service_id,
      )
      .run();
    try {
      await runMonitor(
        env,
        m.scope,
        m.service_id,
        `scheduled-${m.service_id}-${tick}`,
        "scheduler",
      );
    } catch {
      await repo.audit("scheduler", "probe", "unavailable");
    }
  });
  const providers = (
    await env.DB.prepare(
      `SELECT i.* FROM integrations i JOIN environments e ON e.scope=i.scope JOIN applications a ON a.id=e.application_id WHERE a.workspace_id='default' AND i.enabled=1 AND (i.last_checked_at IS NULL OR i.last_checked_at<?) ORDER BY i.last_checked_at ASC,i.scope LIMIT 3`,
    )
      .bind(new Date(Date.now() - 3600000).toISOString())
      .all<import("./contracts").Integration & { scope: string }>()
  ).results;
  for (const integration of providers)
    try {
      await syncIntegration(
        env,
        new Operations(env.DB, integration.scope),
        integration,
      );
    } catch {
      await new Operations(env.DB, integration.scope).audit(
        "scheduler",
        "integration.sync",
        "unavailable",
      );
    }
  // Live environments first, and each environment isolated, so a failure or a large
  // number of demo environments cannot starve production maintenance.
  const ordered = [...scopes].sort(
    (a, b) => Number(a.mode !== "live") - Number(b.mode !== "live"),
  );
  for (const { scope } of ordered) {
    const repo = new Operations(env.DB, scope);
    try {
      await maintainScope(env, repo);
    } catch {
      await repo
        .audit("scheduler", "scope.maintenance", "unavailable")
        .catch(() => {});
    }
  }
}
async function maintainScope(env: Env, repo: Operations) {
  const scope = repo.scope;
  {
    await reconcile(env, scope);
    await reconcileStalled(env, scope);
    await repo.purge();
    await expireConversations(env, repo);
    await repo.expireOperatorWaits();
    await deliverNotifications(env, repo);
    const contexts = (
      await repo
        .stmt(
          "SELECT agent_name FROM conversations WHERE scope=? ORDER BY maintained_at ASC LIMIT 20",
        )
        .all<{ agent_name: string }>()
    ).results;
    for (const context of contexts) {
      const agent = env.ASSISTANT.get(
        env.ASSISTANT.idFromName(context.agent_name),
      );
      // One unreachable agent must not stop maintenance of the others.
      await agent
        .fetch(
          new Request("https://agent.internal/conversation", {
            method: "HEAD",
            headers: { "x-ops-scope": scope },
          }),
        )
        .catch(() => undefined);
      await repo
        .stmt(
          "UPDATE conversations SET maintained_at=?2 WHERE scope=?1 AND agent_name=?3",
          new Date().toISOString(),
          context.agent_name,
        )
        .run();
    }
  }
}

// Run `work` over `items` with at most `limit` in flight.
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      // One failing item (e.g. a D1 error on its lease) must not stop the rest.
      while (next < items.length) await work(items[next++]).catch(() => undefined);
    }),
  );
}
