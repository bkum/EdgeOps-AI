# API contract draft

Status: foundation plus operational endpoints are implemented; the wider MVP route sketch below remains a design reference. Prefix `/api/v1`. Derive workspace from verified identity; application/environment identifiers remain authorization-checked. Use cursor pagination and UTC ISO-8601 timestamps.

## Implemented foundation subset

The foundation uses a single authorized synthetic scope; the broader routes below remain proposed. See [setup and limits](../implementation/FOUNDATION.md).

| Method / path (under `/api/v1`) | Current behavior |
| --- | --- |
| GET /overview | Seeded services, bounded incidents, latest fixture health, scoped probe samples and explicit mode |
| POST /demo/scenarios/:scenario/runs | Local development only; healthy, deployment-regression or insufficient-data; empty JSON body and `Idempotency-Key` required |
| GET /incidents/:id | Scoped incident, investigation status and persisted evidence |
| GET /assistant | Persisted 20-message conversation for the verified actor and scope |
| POST /assistant | Strict `{question: "service-health" \| "latest-investigation"}`; SSE with complete persisted messages, no free-form model execution |

All API routes require authentication. Unimplemented endpoints, raw agent routing and foreign incident IDs return 404. Body maximum is 8 KiB. Scenario runs return 202 before Workflow completion. The scoped synthetic service is seeded by the migration; registration endpoints are pending.

## Operational endpoints

All paths below use `/api/v1`. `X-EdgeOps-Scope` selects an authorized registered environment. Bodies use strict schemas; foreign resource IDs return 404/conflict, never data from another scope.

| Methods/path | Behavior |
| --- | --- |
| GET, POST /scopes | List/register application environments in the authenticated workspace |
| GET, POST /services | Registry, dependencies and monitor configuration |
| POST /services/:id/probes | Registered read-only check, idempotency key and per-minute lease |
| GET /incidents/:id/events | Scoped operator timeline |
| POST /incidents/:id/operator-actions | Action/verify/resolve/dismiss/cancel with expectedVersion, note, optional confirmed cause and idempotency key |
| GET /knowledge; PATCH, DELETE /knowledge/:id | Provenance-backed lessons and versioned correction/deletion |
| GET, POST /integrations | Provider resource metadata only, never credentials |
| POST /integrations/:provider/:serviceId/sync | Bounded approved read-only sync with explicit coverage/gaps |
| GET /telemetry, /usage, /settings, /notifications, /audit | Persisted operational views |
| PATCH /settings | AI circuit breaker, call cap, explicit token prices and retention |
| POST /notifications/:id/read | Mark persisted notification read |
| GET /export; POST /retention/run | Scoped sanitized export and retention cleanup |
| GET, POST, DELETE /assistant | Persistent per-actor conversations; POST accepts free-text question and optional conversationId, GET/DELETE accept conversationId query |

Assistant SSE frames: `progress`, `delta` (validated text), `conversation` (canonical messages/status/citations) and safe `error`. A conversation is keyed by verified actor, scope and conversationId. Model-selected tools are read-only and have strict argument schemas; models cannot call mutating HTTP endpoints. Confirmed-knowledge changes invalidate derived conversation context.

## Proposed full MVP API

| Method / path | Purpose |
| --- | --- |
| GET /applications | List authorized applications |
| POST /applications | Register application |
| GET, POST /applications/:appId/environments | List/create environment |
| GET, POST /environments/:envId/services | List/register services |
| GET /environments/:envId/overview | Aggregates with coverage and freshness |
| GET, POST /services/:serviceId/monitors | Read/configure deterministic monitors |
| GET /services/:serviceId/health-checks | Bounded observation history |
| GET /environments/:envId/deployments | Recent deployment evidence |
| GET /environments/:envId/logs | Safe filtered redacted log query |
| GET, POST /environments/:envId/incidents | List/create scoped incidents |
| GET /incidents/:incidentId | Incident, timeline and current run |
| POST /incidents/:incidentId/investigations | Idempotent durable dispatch |
| POST /incidents/:incidentId/operator-actions | Action record, verify, resolve or dismiss with expected version |
| GET /investigations/:runId | Persisted progress and findings |
| GET /evidence/:evidenceId | Authorized sanitized source evidence |
| POST /environments/:envId/conversations | Create scoped chat session |
| GET /conversations/:conversationId/stream | Authenticated streaming transport; exact SDK protocol pending |
| GET, POST /environments/:envId/knowledge | Retrieve/create operator knowledge |
| PATCH, DELETE /knowledge/:entryId | Correct/delete knowledge with audit and propagation |
| GET, POST /environments/:envId/integrations | Read/configure provider references, never return secrets |
| POST /demo/scenarios/:scenarioId/runs | Demo deployment only; quota and isolated session |

All mutating operations require authorization, same-origin/CSRF protection where cookies are used, schema validation, and audit. Idempotency-Key required for incident/run creation and operator actions. Same key plus same payload returns prior result; changed payload conflicts. Optimistic version mismatch returns 409.

Response envelope: `{data, meta: {requestId, nextCursor?}}`. Error envelope: `{error: {code, message, retryable}, requestId}`. Do not expose provider credentials or raw errors. Use 401 unauthenticated, 403 denied, 404 for unavailable scoped resources, 409 conflicts, 422 validation, 429 quotas, and 503 unavailable dependencies. A partial diagnostic result can return 200 with explicit `status: partial` and gaps.

Probe contract: service ID, status (healthy/degraded/unhealthy/unknown), observedAt, latencyMs, HTTP status if received, failure category, evidence ID. Evidence contract: scoped ID, provider, sanitized summary, observedFrom/To, fetchedAt, coverage/sampling and source reference. Investigation contract follows the structured response in [agent design](../architecture/AGENT_DESIGN.md).

Before implementation, convert this draft into schema-backed contracts and test HTTP plus WebSocket/session authorization, invalid ranges, pagination, concurrency and idempotent replay. Chat and tool APIs share the same authorization boundary.

`GET /api/v1/deployments/comparisons` returns scoped latest GitHub revision pairs, source/provenance, configured deployment environment, before/after probe windows and failure-rate/p95 deltas. Deltas are null with an explicit unavailable reason if freshness, environment mapping, revision history, bounds or minimum distinct probe runs fail. Correlation never confirms cause.
