# Contributing

Read [README](README.md), [implementation plan](docs/implementation/PLAN.md), [security requirements](docs/SECURITY.md) and relevant ADRs before changing code. Use the [foundation setup guide](docs/implementation/FOUNDATION.md). Run `npm run check`, `npm run build` and `npm run test:smoke` for runtime changes.

Select a backlog item and define observable acceptance criteria. Keep changes scoped; preserve unrelated work. Add meaningful tests for behavior and failure cases, update affected docs, and record actual AI coding prompts in [PROMPTS.md](PROMPTS.md). Do not invent successful checks or working setup commands.

Use only sanitized synthetic fixtures. Commit no secrets, customer records or private telemetry. Review dependencies and pin tested versions when scaffolding the runtime. Schema and state changes need migration/replay considerations; new architectural boundaries need an ADR. Never run an outage simulation against production.
