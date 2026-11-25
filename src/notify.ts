import { z } from "zod";
import { validateDNS } from "./probes";
import type { Operations } from "./operations";
import type { Env } from "./types";

// External notification delivery (F19). Destinations come only from the deployment
// secret NOTIFICATION_WEBHOOKS, never from the API or the model: a webhook URL is a
// credential and an outbound request target. Each notification is delivered at most
// once per destination (outbox row per pair), with bounded retries and backoff. The
// payload carries the notification title and identifiers only, never evidence.
export const MAX_DELIVERY_ATTEMPTS = 5;
const BACKFILL_MS = 24 * 3600_000;
const destinationSchema = z
  .array(
    z
      .object({
        scope: z.string().min(1).max(200),
        url: z.string().min(1).max(2000),
        format: z.enum(["json", "slack"]).default("json"),
      })
      .strict(),
  )
  .max(20);

// HTTPS on the default port to a public DNS name; no credentials in the authority,
// no fragment. The path (and query) may hold the provider's secret token.
export function webhookURL(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname.length > 253 ||
    !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(url.hostname) ||
    /\.(local|internal|localhost|test|invalid|example)$/.test(url.hostname)
  )
    throw new Error("destination_denied");
  return url;
}
// Invalid configuration fails closed: no destinations rather than a guess.
export function destinations(env: Pick<Env, "NOTIFICATION_WEBHOOKS">, scope: string) {
  let parsed: z.infer<typeof destinationSchema>;
  try {
    parsed = destinationSchema.parse(JSON.parse(env.NOTIFICATION_WEBHOOKS ?? "[]"));
  } catch {
    return [];
  }
  return parsed.filter((d) => d.scope === scope);
}
// Stable non-reversible key, so stored rows never contain the URL.
export async function destinationKey(url: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)),
  );
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const backoff = (attempts: number, now: number) =>
  new Date(now + Math.min(60, 5 * 2 ** (attempts - 1)) * 60_000).toISOString();

export async function deliverNotifications(
  env: Env,
  repo: Operations,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const stamp = new Date(now).toISOString();
  const counts = { enqueued: 0, sent: 0, retrying: 0, failed: 0 };
  for (const destination of destinations(env, repo.scope)) {
    const key = await destinationKey(destination.url);
    // Recent notifications only: configuring a destination does not replay history.
    const enqueued = await repo
      .stmt(
        "INSERT OR IGNORE INTO notification_deliveries(scope,notification_id,destination,state,attempts,next_attempt_at,created_at) SELECT scope,id,?2,'pending',0,?3,?3 FROM notifications WHERE scope=?1 AND created_at>=?4 ORDER BY created_at LIMIT 50",
        key,
        stamp,
        new Date(now - BACKFILL_MS).toISOString(),
      )
      .run();
    counts.enqueued += enqueued.meta.changes;
    const due = (
      await repo
        .stmt(
          "SELECT d.notification_id,d.attempts,n.title,n.incident_id,n.created_at,i.service_id,i.status FROM notification_deliveries d JOIN notifications n ON n.scope=d.scope AND n.id=d.notification_id JOIN incidents i ON i.scope=n.scope AND i.id=n.incident_id WHERE d.scope=?1 AND d.destination=?2 AND d.state='pending' AND d.next_attempt_at<=?3 ORDER BY d.next_attempt_at LIMIT 20",
          key,
          stamp,
        )
        .all<{
          notification_id: string;
          attempts: number;
          title: string;
          incident_id: string;
          created_at: string;
          service_id: string;
          status: string;
        }>()
    ).results;
    if (!due.length) continue;
    const finish = (id: string, state: string, error: string | null) =>
      repo
        .stmt(
          "UPDATE notification_deliveries SET state=?2,last_error=?3,sent_at=CASE WHEN ?2='sent' THEN ?4 ELSE sent_at END WHERE scope=?1 AND notification_id=?5 AND destination=?6",
          state,
          error,
          stamp,
          id,
          key,
        )
        .run();
    let url: URL | null = null;
    let denied: string | null = null;
    try {
      url = webhookURL(destination.url);
      await validateDNS(url.hostname, fetcher);
    } catch (error) {
      denied =
        error instanceof Error && ["destination_denied", "private_resolution"].includes(error.message)
          ? error.message
          : "dns_unavailable";
    }
    for (const row of due) {
      // Claim the attempt first: a concurrent run that read the same row sends nothing.
      const attempt = row.attempts + 1;
      const claimed = await repo
        .stmt(
          "UPDATE notification_deliveries SET attempts=?2,next_attempt_at=?3 WHERE scope=?1 AND notification_id=?4 AND destination=?5 AND state='pending' AND attempts=?6",
          attempt,
          backoff(attempt, now),
          row.notification_id,
          key,
          row.attempts,
        )
        .run();
      if (!claimed.meta.changes) continue;
      // A denied destination never becomes valid by retrying.
      if (denied === "destination_denied" || denied === "private_resolution") {
        await finish(row.notification_id, "failed", denied);
        counts.failed++;
        continue;
      }
      let outcome: "sent" | "retry" | "failed" = "retry";
      let error: string | null = denied;
      if (url && !denied)
        try {
          const text = `[EdgeOps ${repo.scope}] ${row.title}: service ${row.service_id}, incident ${row.incident_id} (${row.status}).`;
          const response = await fetcher(url, {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(5000),
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "EdgeOps-Notifications/1.0",
              "Idempotency-Key": `${row.notification_id}:${key}`,
            },
            body: JSON.stringify(
              destination.format === "slack"
                ? { text }
                : {
                    type: "edgeops.notification",
                    id: row.notification_id,
                    scope: repo.scope,
                    incidentId: row.incident_id,
                    serviceId: row.service_id,
                    incidentStatus: row.status,
                    title: row.title,
                    createdAt: row.created_at,
                    text,
                  },
            ),
          });
          await response.body?.cancel();
          if (response.status >= 200 && response.status < 300) outcome = "sent";
          else if (response.status === 429 || response.status >= 500) error = `http_${response.status}`;
          else {
            outcome = "failed";
            error = `http_${response.status}`;
          }
        } catch (e) {
          error = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error";
        }
      if (outcome === "retry" && attempt >= MAX_DELIVERY_ATTEMPTS) outcome = "failed";
      if (outcome === "sent") {
        await finish(row.notification_id, "sent", null);
        counts.sent++;
      } else if (outcome === "failed") {
        await finish(row.notification_id, "failed", error);
        counts.failed++;
      } else {
        await finish(row.notification_id, "pending", error);
        counts.retrying++;
      }
    }
  }
  if (counts.sent || counts.failed || counts.retrying)
    await repo.audit(
      "scheduler",
      "notification.deliver",
      `sent=${counts.sent} retrying=${counts.retrying} failed=${counts.failed}`,
    );
  return counts;
}

// Host and delivery counts per configured destination; never the URL itself.
export async function destinationsStatus(env: Env, repo: Operations) {
  const out = [];
  for (const destination of destinations(env, repo.scope)) {
    const key = await destinationKey(destination.url);
    let host = "invalid";
    try {
      host = webhookURL(destination.url).hostname;
    } catch {
      host = "invalid";
    }
    const rows = (
      await repo
        .stmt(
          "SELECT state,COUNT(*) AS n FROM notification_deliveries WHERE scope=? AND destination=? GROUP BY state",
          key,
        )
        .all<{ state: string; n: number }>()
    ).results;
    const count = (state: string) => rows.find((r) => r.state === state)?.n ?? 0;
    out.push({
      destination: key,
      host,
      format: destination.format,
      sent: count("sent"),
      pending: count("pending"),
      failed: count("failed"),
    });
  }
  return out;
}
