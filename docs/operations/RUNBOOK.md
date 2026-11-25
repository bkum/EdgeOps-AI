# Operations runbook draft

The local runtime and operational controls are implemented. Follow [operational setup](../implementation/OPERATIONS.md). Remote deployment/backup and broader pilot checks still require environment-specific configuration.

## Before first deployment

Pin dependencies, build from a clean checkout, configure separate demo/live bindings, apply tested migrations, provision secrets, validate Access claims and scope, choose retention/budget ceilings, and verify read-only provider permissions. Document actual commands when implemented. Never publish placeholder commands as working setup.

## Daily health

Check latest scheduler observation, probe freshness, Workflow backlog, failed outbox dispatches, provider rate limits, model errors, daily spend counters and storage growth. Missing scheduler output is unknown health. Monitor EdgeOps itself; the agent cannot be the only signal for a Cloudflare-wide outage.

## Incident handling

Inspect evidence coverage before accepting a diagnosis. Apply any fix through the existing provider/operator process. Record actual actions; request recovery checks; confirm cause separately from recovery. For false alarms, dismiss with reason and calibrate thresholds with a minimum sample window.

## Failure recovery

- Provider unavailable: preserve monitoring that still works; report partial findings and bounded retry time.
- AI unavailable/budget exhausted: stop inference, keep deterministic checks and incident records.
- Stuck investigation: inspect persisted run/outbox state; retry idempotently or cancel with reason.
- Credential exposure: disable affected integration, rotate/revoke token, inspect sanitized audit, remove leaked copies according to retention policy.
- Bad release: use the documented deployment rollback process after verifying schema compatibility; do not roll back D1 blindly.

`npm run verify:restore` now rehearses Wrangler SQL export/import into isolated local stores and checks records, foreign keys, quick-check results, triggers and the migration ledger. Before production adoption, repeat restoration into a separate remote D1 database using the actual deployment configuration, and record recovery time/data loss. No RPO/RTO commitment exists yet. Reset/purge is demo-only unless the operator explicitly selects scoped live records and accepts deletion.
