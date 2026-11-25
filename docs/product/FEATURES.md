# Feature expectations

P0 = V0.1 gate; P1 = next increment; P2 = later. All rows are planned.

| ID | Capability | Priority | Acceptance expectation |
| --- | --- | --- | --- |
| F01 | Workspace/application/environment registry | P0 | One workspace supports at least two applications; server checks every scope |
| F02 | Services, resources, dependencies | P0 | Register URLs and provider IDs; validate ownership and safe probe targets |
| F03 | HTTP monitoring | P0 | Five-minute default, timeouts, latency, status, UTC timestamp, freshness |
| F04 | Deterministic detection | P0 | Configurable thresholds, observation windows, sample minimum, deduplication |
| F05 | Worker metrics/logs | P0 | Bounded read-only queries; show sampling, coverage, unavailable permissions |
| F06 | Conversational assistant | P0 | Streaming, cancel/reconnect, scoped tools, evidence references and unknowns |
| F07 | Incident lifecycle | P0 | Severity, affected service, timeline, dedupe key, operator actions and audit |
| F08 | Durable investigation | P0 | Retry safe steps; rank hypotheses; survive browser closure; expose partial failure |
| F09 | Recent deployments | P0 | Retrieve timestamps and immutable revision IDs; correlation is not proof |
| F10 | Recovery verification | P0 | Three successful probes by default; show missing metrics; operator confirms cause |
| F11 | Persistent operational memory | P0 | New conversations retrieve scoped confirmed history; unconfirmed entries labeled |
| F12 | Authentication and audit | P0 | Access token validation, authorization per request/tool, sanitized audit records |
| F13 | Budgets and redaction | P0 | Hard query/token/tool caps; PII/secret filters before inference and persistence |
| F14 | Demo isolation | P0 | Three seeded scenarios; no production credentials; real AI and workflow; quota/reset |
| F15 | Deployment intelligence | P1 | Compare before/after windows and traffic mix; link evidence and alternative causes |
| F16 | Database telemetry | P1 | Restricted aggregate health only; no customer records or arbitrary SQL |
| F17 | Auth analytics | P1 | Aggregate failures by category; no identities, sessions, passwords or OTPs |
| F18 | Usage and estimated cost | P1 | Period, rate provenance, assumptions, exclusions; distinguish estimates from invoices |
| F19 | Notifications | P1 | Operator configures destination; delivery deduplication and bounded retries |
| F20 | Semantic history | P1 | Scope filtering before results; original records remain authoritative |
| F21 | Large evidence | P1 | Optional R2 with scope, expiry and deletion controls; not required for MVP |
| F22 | Security intelligence | P2 | WAF/rate-limit evidence with permissions and uncertainty disclosed |
| F23 | DNS/TLS intelligence | P2 | Read-only configuration/change records and verified expiry collector |
| F24 | OpenTelemetry adapter | P2 | Normalize sanitized application telemetry to common evidence contracts |
| F25 | Approved remediation | P2 | Separate future ADR, per-action approval, narrowly scoped executor, rollback design |

## Monitoring defaults to validate

| Signal | Warning | Critical | Guard |
| --- | --- | --- | --- |
| HTTP check | One failure | Three consecutive failures | Five-minute cadence; timeout counts as failure |
| API p95 | >500 ms | >2,000 ms | Ten-minute window, >=100 requests initially |
| 5xx rate | >1% | >5% | Ten-minute window, >=100 requests initially |
| Certificate expiry (later) | <30 days | <7 days | Collector must report expiry reliably |
| Resource budget (later) | >=70% | >=90% | Configured period and known meter |

Low volume means insufficient data, not healthy. Probe latency and provider request p95 are different metrics. Thresholds are starting assumptions and require TrustPlate calibration. Missing scheduled results make health unknown/stale. Maintenance suppression must be explicit and audited.
