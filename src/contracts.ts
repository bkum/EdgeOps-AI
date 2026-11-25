import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const requestKey = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
export const serviceSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["synthetic", "http"]),
    targetUrl: z.url().max(500).optional(),
    enabled: z.boolean().default(false),
    intervalSeconds: z.number().int().min(60).max(86400).default(300),
    slowMs: z.number().int().min(100).max(30000).default(2000),
    minimumSamples: z.number().int().min(3).max(20).default(3),
    failureThreshold: z.number().int().min(1).max(20).default(2),
    expectedStatus: z.number().int().min(200).max(299).default(200),
    dependencies: z.array(id).max(20).default([]),
  })
  .strict()
  .refine(
    (v) => v.failureThreshold <= v.minimumSamples,
    "Failure threshold must not exceed minimum samples",
  )
  .refine(
    (v) => v.kind !== "http" || !!v.targetUrl,
    "HTTP services require a health URL",
  );
export const operatorSchema = z
  .object({
    action: z.enum([
      "record-action",
      "verify",
      "resolve",
      "dismiss",
      "cancel",
      "retry",
    ]),
    expectedVersion: z.number().int().positive(),
    note: z.string().trim().min(1).max(1000),
    cause: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export const knowledgeSchema = z
  .object({
    content: z.string().trim().min(1).max(1000),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const integrationSchema = z
  .object({
    provider: z.enum(["cloudflare", "github", "supabase"]),
    serviceId: id,
    enabled: z.boolean(),
    config: z
      .object({
        accountId: z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .optional(),
        workerName: id.optional(),
        repository: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .optional(),
        environment: z
          .string()
          .regex(/^[\w-]{1,80}$/)
          .optional(),
        projectRef: z
          .string()
          .regex(/^[a-z0-9]{10,40}$/)
          .optional(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) =>
      v.provider === "cloudflare"
        ? !!v.config.accountId && !!v.config.workerName
        : v.provider === "github"
          ? !!v.config.repository
          : !!v.config.projectRef,
    "Required resource identifiers missing",
  );
export const settingsSchema = z
  .object({
    dailyAiLimit: z.number().int().min(0).max(100),
    aiEnabled: z.boolean(),
    inputPrice: z.number().min(0).max(10000).nullable(),
    outputPrice: z.number().min(0).max(10000).nullable(),
    retentionDays: z.number().int().min(1).max(180),
    // Hours an incident may wait for an operator before it is flagged for follow-up.
    operatorWaitHours: z.number().int().min(1).max(168).optional(),
  })
  .strict();
export const environmentSchema = z
  .object({
    applicationId: id,
    applicationName: z.string().trim().min(1).max(100),
    environment: id,
    mode: z.enum(["demo", "live"]),
  })
  .strict();
export const demoRunSchema = z.object({ serviceId: id.optional() }).strict();
export type ServiceInput = z.infer<typeof serviceSchema>;
export type OperatorInput = z.infer<typeof operatorSchema>;
export type IntegrationInput = z.infer<typeof integrationSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export interface Monitor {
  scope: string;
  service_id: string;
  kind: "synthetic" | "http";
  target_url: string | null;
  enabled: number;
  interval_seconds: number;
  slow_ms: number;
  minimum_samples: number;
  failure_threshold: number;
  expected_status: number;
  scenario: string;
  last_scheduled_at: string | null;
}
export interface Knowledge {
  id: string;
  incident_id: string;
  content: string;
  confirmed_by: string;
  confirmed_at: string;
  version: number;
}
export interface Integration {
  provider: "cloudflare" | "github" | "supabase";
  service_id: string;
  config: string;
  enabled: number;
  status: string;
  last_checked_at: string | null;
  safe_error: string | null;
}
export interface Telemetry {
  id: string;
  service_id: string;
  provider: string;
  kind: string;
  status: string;
  summary: string;
  observed_at: string;
  fetched_at: string;
  expires_at: string;
}

export const recommendationDispositionSchema = z
  .object({
    disposition: z.enum(["proposed", "accepted", "rejected", "done"]),
    expectedVersion: z.number().int().positive(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
