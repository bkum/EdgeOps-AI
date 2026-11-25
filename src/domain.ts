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
    recommendations: z.array(z.string().min(1).max(500)).min(1).max(5),
    unknowns: z.array(z.string().min(1).max(500)).min(1).max(5),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;
export function validateFinding(input: unknown, allowedIds: string[]): Finding {
  const finding = findingSchema.parse(input);
  for (const claim of [...finding.observations, ...finding.hypotheses]) {
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
