# Implementation plan

Status: operational MVP implementation extends the foundation with scoped registry, safe approved HTTP probes, lifecycle/recovery, confirmed memory, free-form cited chat, provider adapters, usage and policy controls. See [current operational behavior and release boundaries](OPERATIONS.md). Provider-specific verification and deployment/release tasks remain gated by actual resources and access. Suggested 8–10 working days is an estimate, dependent on API access and SDK integration. Complete security and cost controls throughout, not just at the end.

| Phase | Work | Exit gate | Dependency |
| --- | --- | --- | --- |
| 0 — Definition | Requirements, use cases, architecture, backlog and prompt log | Scope documented; unknowns tracked | Complete in this initialization |
| 1 — Foundation (day 1) | Pin toolchain; create Worker/web app; D1/agent/workflow spike; Access boundary; registry | Synthetic chat calls real model, persists state, starts/resumes one workflow; scope tests pass | Choose account/dev configuration |
| 2 — Monitoring (days 2–3) | HTTP probes, thresholds, provider adapters, service dashboard | Deterministic incident detection and dedupe; stale/partial states; no inference on healthy probes | Verified read-only endpoints |
| 3 — Assistant (days 4–5) | Streaming chat, typed tools, bounded evidence, audit and memory | Scoped questions produce validated evidence-linked responses | Phase 1; fixtures or verified Phase 2 adapters |
| 4 — Investigation (days 6–7) | Outbox dispatch, workflow steps, deployment correlation, operator review, recovery, lessons | Disconnect/retry/recurrence scenarios pass | Phase 2 and 3 |
| 5 — Hardening and delivery (days 8–10) | Demo isolation, evaluations, security tests, cost caps, private live pilot, setup docs and recording | Assignment checklist and live read-only review pass | All prior gates |

## First coding slice

Build one synthetic application/environment/service through registry → probe fixture → incident → real Workflow → one bounded AI summary → D1 evidence → UI. Prove state ownership and retries before expanding integrations. The first implementation adds package scripts, a lockfile, Wrangler bindings, `.dev.vars.example`, D1 migration, and tests. Offline fixture mode is verified end to end; real model execution still needs account validation.

## Definition of done for each slice

Acceptance criteria satisfied; code reviewed; meaningful tests for behavior/failure paths pass; no sensitive fixtures; docs and actual prompt history updated; runtime commands verified; configuration defaults safe; unimplemented UI features labeled. Report measured validation, not expected results.

## Release gates

Rehearse setup from a clean checkout. Verify demo and live bindings differ. Run automated checks plus a scoped read-only pilot. Document reset, retention, budget stop and credential rotation. Review repository naming/submission requirements and prompt transcript completeness. Deploy and record only after runtime implementation exists.
