# Data model and storage ownership

Domain: Workspace → Application → Environment → Service → Resource. All data is scoped server-side. IDs are opaque; timestamps UTC; external identifiers and credential references are separate from secrets.

| Entity | Minimum proposed fields and constraints |
| --- | --- |
| workspaces | id, name, owner identity, created_at |
| applications | id, workspace_id, name, slug; scoped unique slug |
| environments | id, application_id, name, mode; scoped unique name |
| services | id, environment_id, name, kind, allowlisted health URL |
| resources | id, service_id, provider, external_id; scoped provider uniqueness |
| service_dependencies | service_id, depends_on_service_id; same authorized environment |
| integrations | id, environment_id, provider, credential_reference, capability status |
| monitors | id, service_id, signal, interval, thresholds, sample minimum, enabled |
| health_checks | id, monitor_id, scheduled_at, observed_at, status, latency_ms, failure_category; unique scheduled sample |
| incidents | id, environment_id, service_id, severity, status, dedupe_key, opened_at, resolved_at, version |
| investigations | id, incident_id, workflow_id, status, budget, version, started_at, finished_at |
| incident_events | id, incident_id, event_type, actor, idempotency_key, payload, created_at |
| evidence | id, investigation_id, provider, observed_from/to, fetched_at, sanitized summary, coverage, source reference, expiry |
| recommendations | id, investigation_id, proposed action, rationale, evidence_ids, operator disposition |
| knowledge_entries | id, environment_id, incident_id, content, confirmation status, confirmed_by/at, supersedes_id |
| audit_logs | id, scope, actor, action, tool, run_id, result category, redacted input summary, timestamp |
| dispatch_outbox | id, incident_id, operation, idempotency_key, state, attempts, next_attempt_at |

D1 is canonical for entities above. Store conversation messages and interactive agent context in Durable Object SQLite; Workflow storage is canonical for step execution. References connect these stores; do not assume cross-store atomicity. Agent context can be rebuilt from D1 records and conversation history.

Use indexes for environment/time, service/time, incident status, dedupe lookup, evidence/run, and knowledge scope. Enforce one active incident per scope/service/signal via a unique active key or equivalent transactional claim. Bind queries; do not concatenate model-generated SQL. Apply authorization in repositories as well as API handlers.

Proposed pilot retention: probe rows 30 days; sanitized evidence 30 days; chat 30 days; incident summaries and confirmed lessons 180 days; audit 90 days. Confirm these before live use. Purge jobs must remove derived agent context and later vector/object copies; deleted/expired evidence remains marked unavailable in citations. Keep sensitive data out of every store, including audit and Workflow step output.

`migrations/0001_foundation.sql` defines the scoped synthetic subset, uniqueness/indexes, outbox, audit and inference reservations; local migration and constraints are exercised in tests. The broader entities above remain proposed. Existing-database upgrade rehearsal remains required. Backup/export and restore rehearsal precede production adoption.
