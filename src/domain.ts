import { z } from "zod";

export const scenarioSchema = z.enum([
  "healthy",
  "deployment-regression",
  "database-slowdown",
  "recurring-api-failure",
  "insufficient-data",
]);
export type Scenario = z.infer<typeof scenarioSchema>;
export const sampleSchema = z
  .object({
    observedAt: z.iso.datetime(),
    status: z.enum(["healthy", "unhealthy", "unknown"]),
    latencyMs: z.number().int().min(0).max(60_000),
  })
  .strict();
export type Sample = z.infer<typeof sampleSchema>;
export function detect(samples: Sample[]) {
  const valid = samples.filter((s) => s.status !== "unknown");
  if (valid.length < 3) return "unknown";
  return valid.filter((s) => s.status === "unhealthy").length >= 2
    ? "unhealthy"
    : "healthy";
}

// Server-defined follow-up queries the model may request by name only. It never supplies
// scope, service, time range, URLs or SQL: the server derives all of them from the incident.
export const FOLLOW_UPS = [
  "probe-history-24h",
  "dependency-health",
  "recent-deployments",
  "worker-logs",
] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number];
export const MAX_FOLLOW_UPS = 2;
export const recommendationSchema = z.union([
  z.string().min(1).max(500),
  z
    .object({
      action: z.string().min(1).max(500),
      rationale: z.string().min(1).max(500).optional(),
      evidenceIds: z.array(z.string()).max(5).optional(),
    })
    .strict(),
]);
export type Recommendation = z.infer<typeof recommendationSchema>;
export const recommendationAction = (r: Recommendation) =>
  typeof r === "string" ? r : r.action;
export const findingSchema = z
  .object({
    summary: z.string().min(1).max(1500),
    observations: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            evidenceIds: z.array(z.string()).min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    hypotheses: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            evidenceIds: z.array(z.string()).min(1).max(5),
            confidence: z.enum(["low", "medium"]),
          })
          .strict(),
      )
      .max(3),
    // A plain manual step, or one with its rationale and supporting evidence.
    recommendations: z.array(recommendationSchema).min(1).max(5),
    unknowns: z.array(z.string().min(1).max(500)).min(1).max(5),
    followUps: z.array(z.enum(FOLLOW_UPS)).max(MAX_FOLLOW_UPS).optional(),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;
export function validateFinding(input: unknown, allowedIds: string[]): Finding {
  const finding = findingSchema.parse(input);
  for (const claim of [
    ...finding.observations,
    ...finding.hypotheses,
    ...finding.recommendations.map((r) => (typeof r === "string" ? { evidenceIds: [] } : { evidenceIds: r.evidenceIds ?? [] })),
  ]) {
    if (claim.evidenceIds.some((id) => !allowedIds.includes(id)))
      throw new Error("Invalid evidence citation");
  }
  return finding;
}

export const questionSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    conversationId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .optional(),
  })
  .strict();
