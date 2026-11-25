export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ASSISTANT: DurableObjectNamespace;
  INVESTIGATION: Workflow<{
    scope: string;
    incidentId: string;
    attempt?: number;
  }>;
  AI?: Ai;
  PROBE_ALLOWLIST?: string;
  PROVIDER_RESOURCES?: string;
  CLOUDFLARE_TELEMETRY_TOKEN?: string;
  GITHUB_READ_TOKEN?: string;
  SUPABASE_READ_TOKEN?: string;
  MODE: string;
  AI_MODE: string;
  DAILY_AI_LIMIT: string;
  LOCAL_API_TOKEN?: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_SUBJECTS: string;
  // Optional JSON {"<subject>": ["app/env", ...] | ["*"]}; unset means every allowed
  // subject may use every environment (single trusted operator).
  SCOPE_GRANTS?: string;
}

export const SCOPE = "synthetic/demo";
export interface Principal {
  actor: string;
  scope: string;
  // "*" grants every environment in the workspace; otherwise an explicit list.
  scopes: "*" | string[];
}
export interface Incident {
  id: string;
  scope: string;
  service_id: string;
  status: string;
  opened_at: string;
  version: number;
  scenario: string;
  recurrence_of?: string | null;
  resolved_at?: string | null;
  cause_status?: string;
  confirmed_cause?: string | null;
}
export interface Investigation {
  id: string;
  scope: string;
  incident_id: string;
  status: string;
  attempt: number;
  workflow_id: string | null;
  result: string | null;
  updated_at: string;
}
export interface Evidence {
  id: string;
  scope: string;
  investigation_id: string;
  provider: string;
  summary: string;
  observed_at: string;
  fetched_at: string;
}
