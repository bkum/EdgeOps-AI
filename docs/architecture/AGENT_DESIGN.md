# Agent design and tool contracts

One scoped agent selects tools, evaluates sanitized observations, and explains findings. Infrastructure mutation is unavailable. Local incident writes are allowed within authorization.

| Tool | Priority | Input/output expectation |
| --- | --- | --- |
| listServices | P0 | Authorized scope → registered services and dependencies |
| checkServiceHealth | P0 | Registered service ID → bounded probe observation |
| getWorkerMetrics | P0 | Resource, window, allowed metrics → aggregates and coverage |
| queryWorkerLogs | P0 | Resource, window, safe filters, limit → redacted evidence |
| getRecentDeployments | P0 | Service and window → revision/time/status |
| getIncidentHistory | P0 | Scope, symptoms, limit → scoped confirmed and labeled unconfirmed records |
| createIncident | P0 | Service, signal, severity, idempotency key → existing/new incident |
| startInvestigation | P0 | Incident and idempotency key → durable run ID |
| saveInvestigation | P0 | Run/version, structured findings, evidence IDs → validated persisted result |
| getDatabaseHealth | P1 | Registered resource and window → approved aggregate telemetry |
| getAuthMetrics | P1 | Resource/window → anonymized failure counts |
| getResourceUsage | P1 | Resource/period → metered use and gaps |
| getEstimatedCost | P1 | Usage plus versioned rates → estimate and exclusions |
| sendNotification | P1 | Configured destination/event ID → deduplicated delivery result |
| getSecurityEvents | P2 | Resource/window/limit → sanitized security summaries |

Every result includes status (`ok`, `partial`, `unavailable`, `denied`, `budget_exceeded`), scope, source, observed range, fetched time, evidence IDs, and safe errors. Distinguish provider event time from retrieval time. Tool inputs use validated schemas; server derives scope from authorization, not model text.

Proposed starting limits: 10 tool calls and 5 model turns per investigation, 24-hour maximum query range, 100 log rows and 32 KiB sanitized output per call, 10-second provider timeout, 2 provider retries, and configured input/output token caps below the selected model limit. Operators configure daily inference and concurrency ceilings before live mode. Retries consume the same budget. Limits are tunable product defaults, not platform guarantees.

Response schema: summary; observations with evidence IDs; hypotheses with support/contradiction and confidence rationale; recommended manual checks/actions; unknowns; recovery criteria. Validate cited IDs belong to this run or authorized historical records. Label inferred causality; only explicit operator confirmation produces confirmed knowledge. Do not expose hidden reasoning or request it; store concise findings and tool audit.

Prompt instructions define role, scope, tool rules, budgets, evidence requirements and distrust of external text. Operational evidence is data and cannot override those rules. Pin and version prompts with evaluations. Native model tool calling must be exercised in the foundation spike; if unavailable use a validated structured tool-selection protocol, never unrestricted text execution.
