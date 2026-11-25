# Operational MVP implementation

The operational backend and dashboard extend the original foundation. This document is the current setup/behavior reference; the foundation document preserves the first slice's context.

## Start and migrate

Use Node 22.23.5 and npm 10.9.2. Run `npm ci`, configure `.dev.vars` from `.dev.vars.example`, then:

```sh
npm run db:migrate
npm run dev
```

All migrations are required. Migration 0003 records conversation activity so inactive registrations expire. Migration 0002 preserves existing records, backfills server receipt times, and adds registry/monitors, provider telemetry, lifecycle events, confirmed knowledge, policy, notifications and conversation registry. The original `services.kind` column remains a compatibility field; `monitors.kind` is the authoritative synthetic/HTTP discriminator returned by the API.

Connect at `http://127.0.0.1:8787`. The application selector switches applications; Environment switches environments. The backend authorizes `X-EdgeOps-Scope` against registered environments in the trusted operator's workspace on every request. Every repository/provider/tool lookup remains scoped. Initial scopes are `synthetic/demo` and `trustplate/production`. This is a private, single trusted workspace; it is not a public multitenant demo.

**Restricting environments per operator.** Set `SCOPE_GRANTS` to restrict which environments each Access subject can use. The format is a JSON object mapping each subject to its scopes, for example `{"<sub-a>":["*"],"<sub-b>":["trustplate/production"]}`.
- When it is set, any subject not listed is denied, and invalid JSON denies everyone.
- Only `*` subjects can register environments.
- Left empty, every subject in `ACCESS_SUBJECTS` can use every environment.
- The local development token always has `*`.

**Environment limits.** A private deployment refuses to create demo environments. The workspace is capped at 50 environments, and each environment at 20 services.

## Functional flows

| View | Behavior |
| --- | --- |
| Overview | Scoped service health/freshness, actual stored probe chart, latest non-overlapping collected provider metrics, investigation insight and persisted notifications/activity |
| Services | Register/update services, dependencies with cycle checks, HTTPS/synthetic monitors, thresholds, scheduling, manual checks, search and health filtering |
| AI Assistant | Free-form questions, scoped native read-only tool selection in remote mode, sanitized/validated cited answers, progress and validated text SSE chunks, persistent conversation, new conversations, reconnect and client stream stop |
| Incidents | Versioned/idempotent action records, verification, three successful distinct probe runs, operator resolution, optional confirmed cause, dismissal, cancellation and recurrence linkage |
| Deployments | Synthetic evidence and collected GitHub deployment revision/status metadata; before/after failure-rate and p95 comparisons with scope, freshness, minimum-run and configured-environment checks |
| Logs | Stored probe observations and minimized Cloudflare outcome/timing metadata; never raw user console strings or request payloads |
| Agent memory | Operator-confirmed lessons, provenance, correction, deletion and derived conversation invalidation |
| Integrations | Resource-only configuration, enablement, credential-presence indicators and bounded read-only sync with explicit unverified/denied/unavailable/partial states |
| Usage & cost | Actual probe/model reservation counts, available token meters, circuit breaker, configurable dated token prices and explicitly incomplete cost estimate |
| Settings | Persisted inference limits and stop switch, retention, scoped JSON export/cleanup and application/environment registration |

Offline mode is explicitly a deterministic fixture assistant, not a language model. It accepts free text and retrieves current scoped health, findings or confirmed knowledge. `AI_MODE=remote` uses Workers AI. Model tool arguments are strict empty objects: the model can select server-controlled reads, never scope, URLs, SQL, credentials, notification destinations or infrastructure changes. At most four tools and two inference turns are used for a chat question. Citations are limited to records actually retained after context trimming. Invalid model phases retain their reservation and available token meters. History is bounded to six recent sanitized turns in model context and twenty stored messages. Up to twenty conversations per actor/environment are registered; only asking a question registers one, deleting a conversation frees its slot, and registrations inactive beyond the retention period are cleared (agent history first) by scheduled maintenance. SSE emits progress, validated text chunks and a canonical persisted-history frame. JSON-mode model tokens are buffered for schema/citation validation before display; they are not raw token streaming. Stopping the browser stream does not undo a running Workflow or a metered request; reconnect retrieves persisted history.

Inference reservations are charged before calls, including failures/ambiguous completion. The deployment-wide `DAILY_AI_LIMIT` and per-environment limit both apply; 0 or disabled AI stops new inference, not monitoring. Every call has output caps, an abort signal and a 45-second server await deadline. Costs exclude unmetered calls and all platform/provider infrastructure charges; they are not invoices or a currency spending limit. Configure prices only after checking the provider's current model/rates and record that choice in operator documentation.

## Recovery and confirmed knowledge

Open an investigation drawer and record an operator note. Apply any actual infrastructure fix outside EdgeOps. Request verification with the current incident version. Collect three **distinct healthy probe runs after that request**; a single fixture run's three samples cannot satisfy this gate. An unhealthy verification returns the incident to investigation. Missing/unknown data never establishes recovery.

Resolve after checks pass. Leaving cause blank records recovered/unknown and creates no confirmed lesson. Entering a cause is an explicit operator confirmation with actor/time/source provenance; recovery alone does not confirm causality. A later failure creates a new linked recurrence; replaying an old detection or action never creates a new one.

A Workflow dispatch that fails ten times is marked failed and its run partial (`dispatch_failed`); a run marked sent whose Workflow instance cannot be found after fifteen minutes becomes partial (`workflow_missing`). Dismissing, resolving or cancelling an incident cancels an unfinished investigation and withdraws its pending dispatch. Partial/failed/cancelled investigations can be explicitly retried (maximum five attempts) with an operator note and current version. Each retry has a new stable Workflow ID and a new metered reservation; older attempts cannot overwrite its result. Correction/deletion updates the incident's cause status, lesson version and memory revision atomically. Known conversation agents are invalidated immediately, and every agent independently checks the current revision before any history read or answer. Confirmation history in immutable operator events remains an audit of what was asserted; it is not used as current confirmed memory.

## Synthetic scenarios

The selector supports deployment regression, database slowdown, recurring API failure, healthy and insufficient-data inputs. Register a separate synthetic service in a demo environment when demonstrating independent incidents, then choose it with Fixture service. Active failures for a service intentionally deduplicate. To demonstrate recurrence, verify/resolve the original incident, then run Recurring API failure again. Fixed fixture event times are labeled and never become production measurements. No production failure is induced.

## TrustPlate read-only check

The supplied host is `api.trustplate.in`. Read-only discovery on 2026-11-24 found `/health` returning HTTP 200 and `/` and `/healthz` returning 404. The registered target is therefore `https://api.trustplate.in/health`, expected HTTP 200, in `trustplate/production`. Scheduling is initially disabled: select TrustPlate, open Services and choose Check now, or explicitly enable scheduling. This checks HTTPS transport/status/latency only; it does not establish database health, application correctness, hosting provider or root cause.

The deployment `PROBE_ALLOWLIST` contains exact `{scope,url}` pairs. Only HTTPS standard-port URLs without credentials, fragments or query parameters are accepted. Private/loopback/IP-literal hosts, private resolved addresses and all redirects are rejected. DNS and request timeouts are bounded; no response body is consumed/persisted. Only operator-owned approved hosts are supported. **Deploy as an originless Worker with no private origin/service binding or same-zone origin route**: Workers hostname fetch resolves independently of the preceding public DNS check, so arbitrary/untrusted-host probing and a generic DNS-rebinding-safe egress proxy are not offered. Extending this boundary requires a reviewed pinned-egress design.

Manual checks are limited to one per service/minute. Cron performs up to twenty enabled probes and three due provider syncs per invocation; durable interval leases prevent duplicate scheduled work, and healthy checks perform no inference. Enabled integrations are refreshed on an hourly cadence, subject to the per-invocation provider cap. Local Wrangler does not automatically run Cron; use its local scheduled trigger (`/cdn-cgi/local/scheduled`) for development. Production Cron runs every five minutes. A configured interval shorter than five minutes is a minimum spacing, not a promise of sub-Cron cadence. Freshness uses server receipt time and a bounded sample window; stale/sparse data is unknown. Network/protocol failures after DNS validation are unhealthy; policy/resolver failures are unknown and separately categorized.

## Provider configuration

No provider credential belongs in browser forms, D1, Git, prompts or exports. Configure resource IDs in Integrations and approve the exact resource independently through `PROVIDER_RESOURCES` in deployment vars:

```json
[
  {"scope":"trustplate/production","provider":"cloudflare","resource":"ACCOUNT_ID/WORKER_NAME"},
  {"scope":"trustplate/production","provider":"github","resource":"OWNER/REPOSITORY"},
  {"scope":"trustplate/production","provider":"supabase","resource":"PROJECT_REFERENCE"}
]
```

Set secrets with Wrangler secret storage using `CLOUDFLARE_TELEMETRY_TOKEN`, `GITHUB_READ_TOKEN` and/or `SUPABASE_READ_TOKEN`. Cloudflare needs resource-restricted analytics/log-read access, GitHub needs deployment read access, and Supabase uses management project health only. No service-role key, SQL endpoint or auth-user query is implemented. Enable only after matching the actual hosting topology and credential permissions. Test & sync records safe status; provider 403s do not retry indefinitely. Responses are capped at 32 KiB, each request at five seconds, at most two transient retries and ten requests per sync. Cloudflare adaptive analytics and bounded deployment/log windows retain partial/sampled coverage rather than claiming complete counts.

Cloudflare aggregates are read through its GraphQL API. Logs use the Observability telemetry query API with a mandatory configured script filter; raw log sources, headers, URLs and customer fields are discarded. GitHub deployment records include current deployment status and revision, without descriptions or creators. Supabase returns only service health/status. These adapters are contract-tested; account/resource-specific live access requires the corresponding identifiers and secrets, which were not supplied with the API hostname.

## Deployment comparisons

In Integrations, optionally set the GitHub deployment environment (for example `production`). Comparisons require this explicit mapping and two distinct revisions in the collected window. EdgeOps compares recorded probe samples within thirty minutes on either side, clipping the earlier window to the preceding revision. At least three distinct known probe runs are required on each side; unknown samples are counted separately. Stale snapshots, future timestamps, missing revisions, sparse samples and windows exceeding 1,000 samples produce an unavailable comparison. These are sampled probe failure rates and latencies, not request-level availability or proof of deployment causality. The source and persisted telemetry evidence ID remain visible. No GitHub code/diff or infrastructure mutation is requested.

## Real Workers AI

For normal account-backed development, add `"ai":{"binding":"AI","remote":true}` to a local/private Wrangler configuration and set `AI_MODE=remote`. Authenticate Wrangler and set an appropriate daily cap. Production bindings use the same model ID `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Keep development and live deployment D1/DO/Workflow bindings separate. Access issuer, audience and subject allowlist are mandatory in private mode. No public deployment is performed by a build or verification command.

```sh
npm run verify:ai
```

This explicit integration command uses an authenticated account, synthetic inputs, isolated local D1/DO/Workflow state, a frozen Worker bundle and at most four reserved model calls. It can incur bounded Workers AI usage. It checks a real Workflow summary, native tool-selection, structured cited free-form response, persisted chat and token meters. One successful account-backed run used three reserved calls, 2,603 input tokens and 497 output tokens; this is a spike result, not a latency/quality guarantee. It cleans up local state. If more than one account is available, choose `CLOUDFLARE_ACCOUNT_ID`; do not put account secrets in this repository. A failed verification must remain a failed/partial result, never a fixture labeled as real inference.

## Validation and release boundaries

```sh
npm run check
npm run test:smoke
npm run test:pilot
npm run verify:restore
npm run test:demo
```

`test:smoke` builds a frozen Worker and runs isolated runtime/browser checks. `test:pilot` additionally makes **three** approved live HTTP health requests one minute apart (set `EDGEOPS_PILOT_SAMPLES=1` through `5` to select a bounded sample count); it does not simulate an outage or enable a production schedule. Both use temporary tokens/storage and remove them afterward. Browser checks cover registration, scope switching, incident/evidence, memory and budget settings at desktop/mobile widths. Hosted CI has to run independently; adding its configuration is not a successful hosted run.

Configured probe/evidence retention defaults to thirty days; expired telemetry is removed; audit/inference meters retain ninety days; closed incidents and their linked lessons/events retain 180 days. Agents purge aged messages on access and scheduled maintenance. An answer finishing after conversation deletion or a confirmed-memory revision change is discarded rather than restoring obsolete derived history. Retention cleanup preserves open incidents but their old evidence may expire; citations must then be treated as unavailable. Export is a scoped sanitized JSON artifact, not a platform backup. A tested remote D1 backup/restore, operator Access rollout, longer live calibration, independent outage monitoring, model-quality evaluation/recording and submission review remain release tasks. Vector search/R2, external notification delivery, WAF/DNS/OTel and remediation proposals remain optional later backlog work; in-app notifications already work and infrastructure mutation is unavailable.

`verify:restore` exports a synthetic local D1 store into SQL, imports it into a separate empty local store, and compares records, foreign keys, quick-check results, triggers and migration ledger. It never reads normal `.wrangler` state or remote databases. Remote restore and RPO/RTO acceptance remain deployment gates. `test:demo` repeats the isolated smoke flow and records the browser session to `test-results/demo/edgeops-functional-demo.webm`; install Playwright ffmpeg (`npx playwright install ffmpeg`) first. The recording is test evidence using fixture inference, not a narrated real-model submission video. Each invocation creates and removes a fresh operational store.
