# Product requirements

Status: proposed V0.1 scope. Owner: Baijnath Kumar. Date: 2026-11-24.

## Problem and users

Small application teams can observe a failure but lack time to correlate metrics, logs, deployments, and past incidents. EdgeOps AI serves an operator responsible for several services and an evaluator who needs a safe, reproducible demonstration. TrustPlate is the pilot, not a hardcoded product dependency.

## Outcomes

An operator can answer “Is the API healthy?”, “What changed?”, and “Have we seen this before?” with time-bounded source evidence. Investigations persist independently of the browser. Suggested causes remain hypotheses until confirmed. Missing telemetry is visible rather than interpreted as healthy.

## Assignment requirements

| Requirement | Planned implementation | Proof |
| --- | --- | --- |
| LLM | Workers AI with initial Llama 3.3 candidate | Real inference in demo with model and run ID |
| Coordination | Worker API, durable agent, investigation Workflow | Resume investigation after disconnect/retry |
| Input | Web chat | Stream a question and evidence-backed answer |
| Memory/state | Durable Object conversation plus D1 incident knowledge | Recall a confirmed incident in a new conversation |
| AI prompt history | PROMPTS.md and dated session records | Actual prompts, edits, and validation; no reconstructed transcript |

## Scope

P0: service registry, environment isolation, monitoring, Cloudflare metrics/log adapters where supported, deployment lookup, chat tools, incidents, durable investigations, recovery verification, structured memory, audit and budgets, isolated demo.

P1: richer deployment comparisons, restricted Supabase telemetry, auth analytics, resource usage and cost estimation, notifications, semantic retrieval, optional large evidence storage.

P2: WAF/security analysis, DNS/configuration drift, richer TLS diagnostics, OpenTelemetry adapters, and approved remediation design. HTTPS probe failures are P0; dedicated certificate-expiry collection requires a verified mechanism.

Excluded from V0.1: autonomous remediation, arbitrary shell/SQL, full observability platform replacement, bulk raw log ingestion, Kubernetes, multi-agent orchestration, billing, mobile, voice, and complex multi-tenant administration.

## Proposed acceptance gates

- All three demo scenarios complete with actual inference, workflow state, and persistent history.
- Every diagnostic claim references evidence or explicitly states an inference/unknown; no unsupported confirmed cause in the curated evaluation set.
- Environment isolation and unauthorized access tests pass for HTTP, streaming, tools, and memory.
- Replayed detection does not duplicate an active incident or investigation.
- Browser reconnect shows persisted progress; provider failure yields partial findings.
- Live pilot uses no customer tables or production write permissions.
- Healthy probes do not invoke inference; budget exhaustion stops further AI work but preserves deterministic monitoring.

These are launch gates, not measured results. Baseline response latency, cost, and operator usefulness during the pilot before setting production SLOs.

## Evolution

V0.1 assignment/TrustPlate → V0.2 other Nyotec applications → V0.3 notifications and expanded incident operations → V0.4 explicitly approved remediation → possible V1 SaaS. This is a direction, not a delivery commitment.
