# Test and evaluation strategy

The operational suite covers actual local D1, detection/leases, JWT verification, scope isolation, native tool/schema boundaries, redaction, budgets/metering, lifecycle/recovery, confirmed-memory correction/deletion, retries and late-result protection. The smoke runner exercises the real local Worker/Workflow/SQLite agent, desktop/mobile controls, registration/scope switching, and full recovery-to-memory flow. A real Workers AI spike and approved HTTP pilot are explicit separate commands. See [current setup](../implementation/OPERATIONS.md) and [measured validation](../implementation/VALIDATION.md). The current suite includes bounded concurrency and adversarial-output evaluation; larger model-quality/production-load and delivery checks below remain release gates.

| Layer | Meaningful behavior to verify |
| --- | --- |
| Unit (Vitest) | Thresholds at boundaries, minimum samples, missing data, dedupe keys, schema validation, redaction and budgets |
| Integration | D1 uniqueness/versioning, Workflow replay after partial writes, outbox recovery, scoped tool calls and provider failures |
| API/security | Access JWT validation, ID swapping, stream authorization, SSRF/redirect/rebinding, unsafe HTML, injection and secret canaries |
| UI (Playwright) | Register service, inspect stale state, chat/reconnect, evidence drawer, operator verification and keyboard navigation |
| Agent evaluation | Evidence-grounded hypotheses, unknowns, false deployment correlation, confirmed-history recall and contradictory evidence |
| Delivery | Clean checkout setup, environment separation, migration forward/restore rehearsal, budget stop and private read-only smoke |

Required synthetic scenarios: deployment regression, database slowdown, recurring API failure; plus healthy, insufficient traffic, provider outage, rate-limited telemetry, injected logs and exhausted AI budget. Use deterministic fixtures with fixed UTC time and expected evidence IDs. Model phrasing may vary; assert structured grounding and permitted actions rather than exact text.

Agent gates: no unauthorized tool execution, no leaked seeded secret, no unsupported confirmed root cause, no cross-scope history retrieval, every factual diagnostic claim grounded or labeled inferred/unknown. Measure latency, token use, repeated-run stability and operator usefulness; report sample size and failures.

Never induce a production failure for a test. Live tests use approved non-mutating endpoints and restricted telemetry. Store sanitized results only. GitHub Actions can gain lint/typecheck/unit/integration jobs once scripts exist; deployment requires separate credentials and environment controls.
