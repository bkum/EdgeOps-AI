import { Repository } from "./repository";
import type { Env } from "./types";

// With a 60-second backoff plus five-minute Cron reconciliation this gives up after
// roughly ten failed creates; the operator can then retry explicitly.
export const MAX_DISPATCH_ATTEMPTS = 10;

export async function reconcile(env: Env, scope: string) {
  const repo = new Repository(env.DB, scope);
  const rows = await repo
    .stmt(
      `SELECT o.id,i.workflow_id,i.attempt FROM dispatch_outbox o JOIN investigations i ON i.scope=o.scope AND i.id=o.id WHERE o.scope=? AND o.state='pending' AND o.next_attempt_at<=? ORDER BY o.next_attempt_at LIMIT 10`,
      new Date().toISOString(),
    )
    .all<{ id: string; workflow_id: string | null; attempt: number }>();
  for (const { id, workflow_id, attempt } of rows.results) {
    const workflowId = workflow_id ?? id;
    try {
      // get().status() distinguishes an existing instance from a non-existent stub.
      let exists = false;
      try {
        const instance = await env.INVESTIGATION.get(workflowId);
        await instance.status();
        exists = true;
      } catch {
        /* create below */
      }
      if (!exists)
        await env.INVESTIGATION.create({
          id: workflowId,
          params: { scope, incidentId: id, attempt },
        });
      await repo
        .stmt(
          `UPDATE dispatch_outbox SET state = 'sent', attempts = attempts + 1 WHERE scope=?1 AND id=?2 AND EXISTS(SELECT 1 FROM investigations WHERE scope=?1 AND id=?2 AND workflow_id=?3)`,
          id,
          workflowId,
        )
        .run();
    } catch {
      const failed = await repo
        .stmt(
          `UPDATE dispatch_outbox SET attempts = attempts + 1, next_attempt_at = ?2, state = CASE WHEN attempts + 1 >= ?5 THEN 'failed' ELSE state END WHERE scope = ?1 AND id = ?3 AND state = 'pending' AND EXISTS(SELECT 1 FROM investigations WHERE scope=?1 AND id=?3 AND workflow_id=?4) RETURNING state`,
          new Date(Date.now() + 60_000).toISOString(),
          id,
          workflowId,
          MAX_DISPATCH_ATTEMPTS,
        )
        .first<{ state: string }>();
      if (failed?.state === "failed") {
        // Surface the stuck run instead of leaving it queued forever; retry stays available.
        await repo.complete(
          id,
          { status: "partial", reason: "dispatch_failed" },
          "partial",
          attempt,
        );
        await repo.audit("scheduler", "workflow.dispatch", "failed");
      }
    }
  }
}

export async function reconcileStalled(env: Env, scope: string) {
  const repo = new Repository(env.DB, scope);
  const runs = (
    await repo
      .stmt(
        "SELECT i.id,i.workflow_id,i.attempt,o.state AS outbox FROM investigations i LEFT JOIN dispatch_outbox o ON o.scope=i.scope AND o.id=i.id WHERE i.scope=? AND i.status IN('queued','running') AND i.updated_at<? ORDER BY i.updated_at ASC LIMIT 10",
        new Date(Date.now() - 15 * 60000).toISOString(),
      )
      .all<{
        id: string;
        workflow_id: string | null;
        attempt: number;
        outbox: string | null;
      }>()
  ).results;
  for (const run of runs) {
    try {
      const instance = await env.INVESTIGATION.get(run.workflow_id ?? run.id);
      const state = await instance.status();
      if (["errored", "terminated", "complete"].includes(state.status)) {
        await repo.complete(
          run.id,
          { status: "partial", reason: "workflow_stalled_or_terminated" },
          "partial",
          run.attempt,
        );
        await repo.audit("scheduler", "workflow.reconcile", "partial");
      }
    } catch {
      // A pending outbox entry is still being dispatched; otherwise the instance was
      // marked sent but cannot be found, so the run can never finish on its own.
      if (run.outbox !== "pending") {
        await repo.complete(
          run.id,
          { status: "partial", reason: "workflow_missing" },
          "partial",
          run.attempt,
        );
        await repo.audit("scheduler", "workflow.reconcile", "partial");
      } else await repo.audit("scheduler", "workflow.reconcile", "unavailable");
    }
  }
}
