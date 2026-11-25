# Implementation backlog

Core operational behavior is implemented and locally validated; external provider verification and delivery remain explicit gates. See [current operations](OPERATIONS.md) and [validation record](VALIDATION.md). “Implemented” below describes code plus local behavior checks, not a production rollout. IDs remain stable.

| ID | Priority | Deliverable / acceptance | Depends on |
| --- | --- | --- | --- |
| B00 | P0 | Documentation and directory scaffold — complete | — |
| B01 | P0 | **Complete:** pin Node/package manager and runtime SDKs; runnable dev/check scripts | B00 |
| B02 | P0 | **Implemented and account-verified:** real Workers AI summary inside a Workflow, persisted agent chat, native tool-selection/free-form answer and token meters | B01 |
| B03 | P0 | **Implemented privately:** Access JWT validation, registered-scope authorization, local-only token; anonymous public-demo sessions remain a release/configuration task | B01 |
| B04 | P0 | **Implemented:** D1 migrations, scoped constraints, registry seeds and transactional lifecycle writes | B01 |
| B05 | P0 | **Implemented:** application/environment selection, service registry, dependency UI/cycle checks and monitor settings | B03,B04 |
| B06 | P0 | **Implemented for approved operator-owned endpoints:** HTTPS adapter, Cron, interval leases, freshness/history; one approved TrustPlate check passed | B05 |
| B07 | P0 | **Implemented:** bounded threshold windows, minimum samples, dedupe, stable dispatch intent and replay protection | B06 |
| B08 | P0 | **Adapter implemented/contract-tested:** scoped Cloudflare aggregates and minimized logs; live account/Worker resource verification awaits identifiers and read credentials | B03,B04 |
| B09 | P0 | **Adapter implemented/contract-tested:** GitHub deployment revisions/status; live repository verification awaits identifiers and read credentials | B03,B04 |
| B10 | P0 | **Implemented:** strict read-only tool boundary, schema/citation validation, redaction, quotas, bounded retry/timeouts and safe audit | B02,B03,B04 |
| B11 | P0 | **Implemented:** free-form chat, progress/validated-text SSE, persisted per-actor conversations, reconnect, stop stream and new conversations | B10 |
| B12 | P0 | **Implemented and model-spiked:** grounded structured responses and current-record citation validation; larger semantic-quality evaluation remains a release gate | B08,B09,B11 |
| B13 | P0 | **Implemented:** incident drawer, action timeline, optimistic/idempotent operator actions, dismissal and cancellation | B07,B05 |
| B14 | P0 | **Implemented:** outbox/reconciliation, explicit bounded retries, stable per-attempt Workflow IDs and late-result rejection | B07,B10,B12 |
| B15 | P0 | **Implemented:** three distinct successful post-verification probe runs, optional explicit cause confirmation and lesson provenance | B13,B14 |
| B16 | P0 | **Implemented:** confirmed history retrieval in new conversations, atomic lesson correction/deletion, canonical cause updates and agent-context invalidation | B15 |
| B17 | P0 | **Implemented:** reproducible deployment regression, database slowdown and recurring failure inputs, plus healthy/insufficient-data cases; private scoped demo only | B14,B16 |
| B18 | P0 | **Implemented suite/caps and bounded concurrency evaluation:** 34 tests, including 60 simultaneous budget reservations, 40 detections/20 replays, rejected model/tool outputs and deadlines; broad production load/model-quality evaluation remains open | B06–B17 |
| B19 | P0 | **Partial:** approved `/health` discovery, initial probe and subsequent three-probe read-only Worker pilot passed; longer private pilot, provider topology and threshold calibration remain | B18, provider access |
| B20 | P0 | **Partial:** pinned setup, CI configuration, successful fresh-source installation/test/build rehearsal, isolated migration/browser checks, tested local SQL backup/restore, reproducible browser demo recording and runbook; hosted CI result, remote restore rehearsal, narrated submission recording and submission review remain | B17–B19 |
| B21 | P1 | **Management-health adapter implemented:** restricted Supabase database/auth service health; richer auth aggregates await a supported approved source and credentials | B19 |
| B22 | P1 | **Implemented:** counters/meters, explicit cost estimates and deployment comparisons with distinct revisions, configured environment, bounded before/after probe windows, minimum distinct runs, failure-rate/p95 changes, provenance and unavailable states | B09,B19 |
| B23 | P1 | **Notifications implemented:** in-app (idempotent) plus opt-in webhook delivery from the `NOTIFICATION_WEBHOOKS` secret, deduplicated per destination with bounded retries | B14 |
| B24 | P1 | **Deferred by design:** scoped confirmed-history retrieval works without semantic search; add Vectorize/R2 only after measured need | B16 |
| B25 | P2 | **Later scope:** WAF, certificate/DNS collection, OTel and approval-based remediation proposals remain outside this operational MVP | Pilot feedback |

Every implementation item includes tests, documentation and prompt history. Do not postpone authorization, sanitization or isolation until B18; B18 validates controls built into earlier slices.
