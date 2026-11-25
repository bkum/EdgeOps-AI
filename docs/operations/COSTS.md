# Usage and cost plan

The source proposal's $0–5/month incremental target is aspirational, not a guaranteed ceiling or verified quotation. No current pricing or future pricing-change claim is adopted here without a fresh check before deployment.

## Workload assumptions

For 5 services at a 5-minute interval: 5 × 24 × 60 / 5 = 1,440 probes/day, or 43,200 over 30 days. At 3 investigations/day and 5 model calls/investigation: 90 investigations and 450 calls/month, excluding chat, retries and evaluation runs. Outbound probes are not necessarily individual billed Worker invocations. Model calls are not a cost unit without token/model usage.

Track Worker requests/CPU, Durable Object requests/duration/storage, D1 rows/storage, Workflow execution/storage, AI input/output tokens or applicable meter, telemetry queries/log ingestion/retention, and any future R2/Vectorize usage. Also distinguish existing TrustPlate spend and incremental EdgeOps spend.

## Controls

Healthy monitoring uses no model. Configure per-run and daily budgets, max concurrency, bounded query windows and provider backoff. Cache suitable aggregates, retain only useful sanitized evidence, and purge expired data. Enforce demo session quotas. Budget exhaustion stops new AI work and surfaces the reason; it must not silently stop probes.

Before deployment, record selected plan, model rate, included allowances, billing period, currency/tax exclusions and date checked using official provider pricing pages. Estimated costs show missing meters and uncertainty; they are never presented as invoices or guaranteed free-tier operation.
