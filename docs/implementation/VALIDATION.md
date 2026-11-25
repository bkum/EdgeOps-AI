# Validation record — 2026-11-24

Only measured checks are recorded here. These results establish a working local operational MVP, not a completed production rollout.

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed strict TypeScript |
| `npm test` | 23 tests passed across four suites, including real Miniflare D1 |
| `npm run test:smoke` | Passed isolated Worker/Workflow/SQLite-agent and desktop/mobile browser flows |
| `npm run build` | Frontend build and Wrangler Worker bundle dry run passed; no deployment |
| `npm run verify:clean` | Fresh source snapshot with no dependencies/runtime state: `npm ci`, strict types, 23 tests, frontend and Worker build passed |
| `npm run verify:ai` | Real Workers AI Workflow summary and native tool-selection/free-form chat passed; validated citations and persisted history, three reserved calls, 2,603 input tokens and 497 output tokens |
| `EDGEOPS_BROWSER=0 EDGEOPS_LIVE_PILOT=1 npm run test:smoke` | One approved live read-only Worker probe to `https://api.trustplate.in/health` returned healthy/HTTP 200; body was cancelled and not persisted |

Browser coverage includes token connection, fixture controls and keyboard selection, investigation drawer, free-form assistant and reconnect, service search/empty state, real service registration, application/environment switching without foreign records, confirmed-memory display, settings persistence, AI stop and actual usage view. Screenshots are generated in ignored `test-results/` (overview desktop/mobile, investigation, assistant and knowledge).

Behavioral coverage includes JWT signature/issuer/audience/expiry failures; minimum samples; unknown/stale data; concurrent incident dedupe and outbox recovery; stable idempotency; three distinct post-verification successful runs; premature/stale actions; explicit cause confirmation versus unknown cause; correction/deletion and current-cause/context invalidation; recurrence; per-attempt retry and late-write rejection; AI caps while healthy monitoring continues; scoped native tools and cited output; minimized provider payloads; approved endpoints, private DNS and redirect rejection; duplicate scheduler leases and metered cost arithmetic.

Model verification uses a real account with synthetic inputs, isolated local operational state and a four-call cap. It is a single successful integration spike, not a broad semantic-quality/latency evaluation. The real HTTP check proves transport status for one request, not hosting topology, database correctness, availability history or calibrated thresholds. No outage was induced. Account/Worker, GitHub repository and Supabase project-specific adapters are contract-tested but cannot be live-verified without their resource identifiers and least-privilege credentials.

During implementation, checks caught and corrected Workers' unsupported `redirect: error`, scheduler lease retention units, mobile accessible navigation naming, a local test harness reload loop (logs and state must stay outside its watched module directory), JSONC parsing, server model deadlines, and structured model response handling. An approval-review usage limit temporarily prevented a regression command from executing; after the user's continuation, the same checks ran successfully. Earlier failed checks are not counted as passes.

Outstanding release work: run hosted CI after committing/pushing; configure private deployment bindings and Access; verify actual provider resources/permissions; rehearse remote D1 backup/restore; perform a longer read-only pilot and threshold calibration; broaden model-quality/load evaluation; create the demo recording and complete submission review. Public anonymous demo sessions, external notification delivery and optional semantic/R2/WAF/DNS/OTel/remediation features are not claimed as shipped.


## Follow-up verification — 2026-11-25

- Strict types, **34 tests across five suites**, frontend and Worker bundle dry run passed. New evaluations exercise 60 concurrent reservations across independent environment budgets, 40 concurrent detections plus 20 replays, invalid/forbidden model tools and citations, provider-context boundaries, binding deadlines and deployment comparisons. These are bounded local behavior checks, not a production throughput or semantic-quality benchmark.
- The tests exposed a real environment-budget defect: the previous query compared global usage to the smaller environment cap. Reservations now atomically check global usage against the global cap and scoped usage against the scoped cap separately.
- `npm run verify:restore` passed actual Wrangler SQL export/import between two disposable local stores. D1 quick-check, foreign keys, both scopes, incident/investigation/evidence/lesson records, cycle trigger and migration ledger matched. D1's unsupported `integrity_check` and Wrangler export's unsupported `--persist-to` were caught during development and replaced with the supported quick-check/default temporary-config-directory store. This is not a remote restore rehearsal.
- `npm run test:demo` passed full local API/Workflow/agent and desktop/mobile flows and saved a browser recording in `test-results/demo/edgeops-functional-demo.webm`. Deployment comparison layout uses an explicit browser fixture; its backend aggregation, scope and freshness behavior is independently tested against D1. Screenshots include `deployments-desktop.png` and `deployments-mobile.png`. No public deployment occurred.
- Real Workers AI recheck passed Workflow summary, native tool selection, validated answer, streaming/reconnect and metering with **3 reserved calls, 1,685 input tokens and 763 output tokens**. Invalid AI phases now preserve token meters and citations cannot name records dropped from model context. Answers finishing after deletion or a memory revision are discarded.

Still external: actual provider resource identifiers and restricted credentials, hosted CI, Access/private deployment configuration, remote restore, long-duration calibration and assignment submission approval. A connected repository search did not establish which repository deploys `api.trustplate.in`; no unrelated repository was configured.

The three-sample live pilot completed successfully on Nov 25, 2026 (Asia/Kolkata): HTTP 200 for all three probes, latencies 372/284/335 ms, spaced about 61 seconds apart. After three distinct known runs the service health became healthy. Response bodies were discarded. Sanitized output is generated in ignored `test-results/live-pilot.json`. This short pilot does not establish long-term availability or calibrated thresholds.
