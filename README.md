# EdgeOps AI

**Your AI SRE for Cloudflare applications.**

EdgeOps AI is an operational intelligence agent in development that investigates application failures using telemetry, explains findings with evidence, recommends operator actions, and remembers confirmed resolutions. It is an independent product; TrustPlate is the first integration.

## Current status

The operational MVP now includes application/environment selection, a scoped service/dependency registry, scheduled/read-only HTTPS probes, durable incident investigations, operator verification/resolution, confirmed knowledge with correction/deletion, free-form cited chat, provider adapter configuration, actual usage counters and persisted budget/retention settings. The shadcn/ui dashboard follows the supplied reference design. Synthetic mode is explicit; provider-specific access requires approved resources and read-only credentials.

`api.trustplate.in/health` has been verified by an approved read-only HTTP check. No application has been deployed. See the [operational setup and implemented boundaries](docs/implementation/OPERATIONS.md).
Use Node 22.23.5 and npm 10.9.2. See the [operational setup and validation guide](docs/implementation/OPERATIONS.md) for token configuration and complete instructions.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Replace LOCAL_API_TOKEN in .dev.vars with a random token (at least 32 characters).
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:8787`, connect with your local token, and run the deployment regression fixture. `npm run check`, `npm run build` (dry run only), and `npm run test:smoke` validate the runtime. `npm run test:pilot` adds one approved health check; `npm run verify:ai` explicitly validates account-backed inference with bounded synthetic inputs. No Cloudflare account is needed for offline mode.

## Goals

- Deliver a Cloudflare AI assignment demonstrating an LLM, workflow coordination, chat input, and persistent state.
- Reduce manual operational investigation for TrustPlate without modifying its infrastructure automatically.
- Support a single workspace with multiple applications and isolated environments.
- Provide a reproducible fixture-backed demo alongside private, read-only live monitoring.

## MVP

1. Register applications, environments, services, dependencies, and integrations.
2. Run scheduled HTTP checks and deterministic anomaly detection.
3. Ask operational questions through streaming chat with bounded telemetry tools.
4. Investigate incidents through durable workflows; expose evidence, hypotheses, recommendations, and gaps.
5. Verify recovery and remember operator-confirmed causes for later investigations.

## Runtime stack

| Responsibility | Choice |
| --- | --- |
| Dashboard | React, TypeScript, shadcn/ui with Tailwind CSS and Radix UI |
| HTTP API and static assets | Cloudflare Workers, Hono, Workers Static Assets |
| Agent and conversation state | Cloudflare Agents SDK, SQLite-backed Durable Objects |
| Inference | Workers AI; initial candidate Llama 3.3 |
| Durable investigations | Cloudflare Workflows |
| Operational records | D1 |
| Scheduling | Cron Triggers; agent scheduling only where required |
| Operator authentication | Cloudflare Access, validated by the backend |
| Development and delivery | Wrangler, Vitest, Playwright, GitHub Actions |
| Later additions | Vectorize similarity search; optional R2 evidence storage |

Dependencies and the Node toolchain are pinned in the lockfile and `.nvmrc`. Local D1/Workflow/agent integration, a real Workers AI summary and free-form answer, and an approved TrustPlate HTTP health check are verified. Provider-specific Cloudflare/GitHub/Supabase access still needs actual resource identifiers and read credentials. See [architecture](docs/ARCHITECTURE.md).

## Start here

- [Documentation index](docs/README.md)
- [Product requirements](docs/PRD.md), [feature expectations](docs/product/FEATURES.md), and [use cases](docs/product/USE_CASES.md)
- [Implementation plan](docs/implementation/PLAN.md) and [backlog](docs/implementation/BACKLOG.md)
- [TrustPlate onboarding](docs/integrations/TRUSTPLATE.md)
- [Security](docs/SECURITY.md), [threat model](docs/THREAT_MODEL.md), and [test strategy](docs/testing/TEST_STRATEGY.md)
- [Demo guide](docs/DEMO_GUIDE.md) and [actual AI prompt history](PROMPTS.md)

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Worker API, agent, workflows, integrations, domain logic |
| `web/` | Dashboard and chat interface |
| `migrations/` | Versioned D1 schema and synthetic registry seed |
| `fixtures/demo-scenarios/` | Synthetic deterministic incident inputs |
| `tests/` | Unit, integration, end-to-end, and agent evaluations |
| `scripts/` | Development and validation utilities |
| `docs/` | Product, architecture, contracts, delivery, operations |
| `.github/` | Contribution templates and foundation CI workflow |

Some directories retain `.gitkeep` for optional later work. The checked-in Wrangler configuration is development-only; no public demo or live deployment is configured.

## Safety and contribution rules

Use synthetic fixtures until read-only integrations are verified. Never commit tokens, customer data, private telemetry, or deployment credentials. The agent may write EdgeOps incident records but cannot mutate monitored infrastructure. Treat external logs as untrusted input. Update requirements, tests, ADRs, and `PROMPTS.md` alongside implementation.

The repository remains named `EdgeOps-AI`. The source proposal suggested `cf_ai_edgeops`; confirm any submission naming requirement before delivery rather than renaming automatically. Deployment at `edgeops.nyotec.com` is a proposal, not configured.

## License

[MIT](LICENSE), copyright 2026 Baijnath Kumar.
