import { z } from "zod";
import type { Operations } from "./operations";

const deploymentSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  environment: z.string(),
  createdAt: z.iso.datetime(),
  state: z.string(),
});
type Check = {
  request_key: string;
  recorded_at: string;
  status: string;
  latency_ms: number;
};
export function summarizeWindow(checks: Check[], start: number, end: number) {
  const rows = checks.filter(
    (r) =>
      Date.parse(r.recorded_at) >= start && Date.parse(r.recorded_at) < end,
  );
  const known = rows.filter((r) => r.status !== "unknown");
  const distinctRuns = new Set(known.map((r) => r.request_key)).size;
  const latencies = known.map((r) => r.latency_ms).sort((a, b) => a - b);
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    samples: rows.length,
    distinctRuns,
    unknown: rows.length - known.length,
    failureRate:
      distinctRuns >= 3
        ? known.filter((r) => r.status === "unhealthy").length / known.length
        : null,
    p95Ms:
      distinctRuns >= 3
        ? latencies[Math.ceil(latencies.length * 0.95) - 1]
        : null,
  };
}

export async function deploymentComparisons(
  repo: Operations,
  now = Date.now(),
) {
  const snapshots = await repo.telemetry("deployments");
  const integrations = await repo.integrations();
  const seen = new Set<string>();
  const comparisons = [];
  for (const snapshot of snapshots) {
    if (snapshot.provider !== "github" || seen.has(snapshot.service_id))
      continue;
    seen.add(snapshot.service_id);
    const parsed = z
      .object({ deployments: z.array(deploymentSchema).max(5) })
      .safeParse(JSON.parse(snapshot.summary));
    if (!parsed.success) continue;
    const integration = integrations.find(
      (i) => i.provider === "github" && i.service_id === snapshot.service_id,
    );
    const configuredEnvironment = integration
      ? (JSON.parse(integration.config) as { environment?: string }).environment
      : undefined;
    const deployments = parsed.data.deployments
      .filter(
        (d) =>
          !configuredEnvironment || d.environment === configuredEnvironment,
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const current = deployments[0];
    if (!current) continue;
    const previous = deployments.find(
      (d) =>
        d.environment === current.environment &&
        d.revision !== current.revision &&
        Date.parse(d.createdAt) < Date.parse(current.createdAt),
    );
    const deployedAt = Date.parse(current.createdAt);
    const start = Math.max(
      previous ? Date.parse(previous.createdAt) : deployedAt - 1800000,
      deployedAt - 1800000,
    );
    const end = Math.min(now, deployedAt + 1800000);
    const monitor = await repo
      .stmt(
        "SELECT kind FROM monitors WHERE scope=? AND service_id=?",
        snapshot.service_id,
      )
      .first<{ kind: string }>();
    const checks = (
      await repo
        .stmt(
          "SELECT request_key,recorded_at,status,latency_ms FROM health_checks WHERE scope=? AND service_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at DESC LIMIT 1001",
          snapshot.service_id,
          new Date(start).toISOString(),
          new Date(Math.max(deployedAt, end)).toISOString(),
        )
        .all<Check>()
    ).results;
    const before = summarizeWindow(checks, start, deployedAt);
    const after = summarizeWindow(
      checks,
      deployedAt,
      Math.max(deployedAt, end),
    );
    const reason = !configuredEnvironment
      ? "Select a GitHub deployment environment in Integrations."
      : Date.parse(snapshot.expires_at) <= now
        ? "Deployment snapshot is stale; sync the integration."
        : !previous
          ? "A preceding distinct revision is unavailable in the collected deployment window."
          : deployedAt > now
            ? "Deployment timestamp is in the future."
            : checks.length > 1000
              ? "Probe window exceeds the bounded comparison limit."
              : before.distinctRuns < 3 || after.distinctRuns < 3
                ? "At least three distinct known probe runs are required on each side."
                : null;
    comparisons.push({
      serviceId: snapshot.service_id,
      evidenceId: snapshot.id,
      environment: current.environment,
      source: monitor?.kind === "http" ? "live-http" : "synthetic",
      current,
      previous: previous ?? null,
      before,
      after,
      status: reason ? "unavailable" : "available",
      reason,
      failureRateDelta: reason
        ? null
        : after.failureRate! - before.failureRate!,
      p95DeltaMs: reason ? null : after.p95Ms! - before.p95Ms!,
      causality: "unconfirmed",
      fetchedAt: snapshot.fetched_at,
    });
  }
  return comparisons;
}
export type DeploymentComparison = Awaited<
  ReturnType<typeof deploymentComparisons>
>[number];
