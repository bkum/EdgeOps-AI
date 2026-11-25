# Incident and investigation lifecycle

Incident status: open → investigating → awaiting_operator → verifying → resolved. Failed verification returns to investigating. Operator may dismiss a false positive with reason. A later recurrence creates a linked new incident. Investigation run status is separate: queued, running, waiting, completed, partial, failed, cancelled.

```mermaid
stateDiagram-v2
  [*] --> Open
  Open --> Investigating: evidence collection starts
  Investigating --> AwaitingOperator: findings saved / run partial
  AwaitingOperator --> Verifying: operator requests verification
  Investigating --> Verifying: operator verifies early
  Verifying --> Resolved: 3 distinct healthy runs, operator resolves
  Verifying --> Investigating: unhealthy run, new attempt queued
  Verifying --> AwaitingOperator: unhealthy run, attempt cap reached
  AwaitingOperator --> Investigating: operator retry
  Open --> AwaitingOperator: operator cancels run
  Investigating --> AwaitingOperator: operator cancels run
  Open --> Dismissed
  Investigating --> Dismissed
  AwaitingOperator --> Dismissed
  Verifying --> Dismissed
  Resolved --> [*]
  Dismissed --> [*]
```

Implemented transitions (verified against `src/operations.ts`, 2026-11-25):

- **Verify** is accepted from `awaiting_operator` or `investigating`. An operator may verify an externally applied fix before the investigation finishes.
- **Dismiss** is accepted from any open state. It records a reason and cancels unfinished diagnostic work.
- **Cancel** stops the run and returns the incident to `awaiting_operator`, where it can be retried.
- **Retry** is allowed for `partial`, `failed` or `cancelled` runs, up to five attempts.
- **Failed verification** re-queues a new attempt when the cap allows; otherwise it returns the incident to the operator. Only probe runs recorded after the latest verify request count.

1. Detect threshold breach using valid windows/sample counts. Claim a scope/service/signal dedupe key, persist incident and dispatch intent.
2. Dispatch Workflow with stable run ID; reconcile dispatch failures from the outbox. Replays return the existing run.
3. Collect independent bounded evidence; provider failures become explicit gaps. Persist sanitized evidence before model access.
4. Retrieve scoped prior incidents/runbooks, preserving confirmation status.
5. Rank hypotheses with the model and allow bounded targeted queries. Persist progress after each completed step.
6. Save findings/recommendations and await operator action. A configurable wait timeout records a pending/manual state rather than resolving the incident.
7. Authenticated operator reports action and asks to verify. Validate event scope, event ID and expected version; reject replayed/stale transitions.
8. Perform three consecutive scheduled successful probes by default and compare available telemetry with baseline. Missing telemetry is disclosed; transport recovery alone cannot confirm a database cause.
9. Resolve with actor, outcome and explicit cause status (confirmed/unknown). Only confirmed lessons enter confirmed memory.

Workflow retry is not exactly-once execution. Every state-changing step needs an idempotency key. Avoid repeating model inference when its validated result is already persisted. Recovery after a partial write uses the saved result, not a new conflicting summary. Set maximum attempts, timeout and total budget per step/run.

Cancellation stops new diagnostic work and records the reason; it does not erase the incident. Only authenticated operator actions change final resolution or confirmation. Scheduled reconciliation detects stuck dispatches and stalled runs without starting duplicate investigations.
