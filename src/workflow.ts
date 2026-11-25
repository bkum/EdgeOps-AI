import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { Operations } from "./operations";
import { syncIntegration } from "./providers";
import { summarize } from "./inference";
import type { Env } from "./types";

export class InvestigationWorkflow extends WorkflowEntrypoint<
  Env,
  { scope: string; incidentId: string; attempt?: number }
> {
  async run(
    event: WorkflowEvent<{
      scope: string;
      incidentId: string;
      attempt?: number;
    }>,
    step: WorkflowStep,
  ) {
    const { scope, incidentId } = event.payload;
    const attempt = event.payload.attempt ?? 1;
    const repo = new Operations(this.env.DB, scope);
    try {
      await step.do(
        "collect-provider-evidence",
        { retries: { limit: 1, delay: "5 seconds" }, timeout: "90 seconds" },
        async () => {
          const detail = await repo.incident(incidentId);
          if (
            !detail ||
            detail.run?.status === "cancelled" ||
            detail.run?.attempt !== attempt
          )
            return;
          const integrations = (await repo.integrations()).filter(
            (i) => i.enabled && i.service_id === detail.incident.service_id,
          );
          for (const integration of integrations)
            await syncIntegration(this.env, repo, integration);
        },
      );
      const evidence = await step.do(
        "persist-synthetic-evidence",
        { retries: { limit: 2, delay: "2 seconds" }, timeout: "15 seconds" },
        () => repo.saveEvidence(incidentId, attempt),
      );
      const result = await step.do(
        "bounded-summary",
        { retries: { limit: 0, delay: "1 second" }, timeout: "75 seconds" },
        async () => {
          const saved = await repo.incident(incidentId);
          if (
            saved?.run?.status === "cancelled" ||
            saved?.run?.attempt !== attempt
          )
            return {
              status: "partial" as const,
              mode: this.env.AI_MODE,
              reason: "cancelled",
            };
          if (saved?.run?.result)
            return JSON.parse(saved.run.result) as Awaited<
              ReturnType<typeof summarize>
            >;
          return summarize(
            this.env,
            repo,
            `investigation:${incidentId}:a${attempt}`,
            evidence,
          );
        },
      );
      // D1 write retries reuse the Workflow's persisted result, never another model call.
      await step.do(
        "persist-summary",
        { retries: { limit: 2, delay: "2 seconds" }, timeout: "15 seconds" },
        async () => {
          await repo.complete(incidentId, result, result.status, attempt);
          await repo.audit("workflow", "investigation.summary", result.status);
        },
      );
      return { incidentId, status: result.status };
    } catch {
      await repo.complete(
        incidentId,
        { status: "partial", reason: "workflow_step_failed" },
        "partial",
        attempt,
      );
      return { incidentId, status: "partial" };
    }
  }
}
