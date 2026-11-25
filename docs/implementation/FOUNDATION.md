# Foundation slice

Historical first-slice snapshot; current behavior and setup are in [OPERATIONS.md](OPERATIONS.md). Implemented 2026-11-24. This is the first coding slice in [PLAN.md](PLAN.md), not completion of all release gates.

## Run locally

Use Node **22.23.5** (`nvm install && nvm use`) and npm 10.9.2. The current Agents dependency requires a newer Node patch than the original workstation's 22.13.1.

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Generate a random token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and replace `LOCAL_API_TOKEN` in `.dev.vars`. The placeholder is rejected. Do not commit this file. Then:

```sh
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:8787`, click Connect in the header, enter the token in the connection dialog and submit. Choose Deployment regression and Run probe fixture. The investigation refreshes automatically. Ask either bounded assistant question; reconnecting with the same identity retrieves persisted conversation history. An optional second terminal running `npm run dev:web` serves hot-reloaded UI at `http://127.0.0.1:5173` and proxies APIs to port 8787.

The local token is accepted only with `MODE=development` and a loopback request URL. Public deployment is disabled in the checked-in configuration. There are no live provider endpoints or tokens. The migration seeds only `synthetic/demo` and its `demo-api` service; application/environment administration is not implemented.

## Validation

```sh
npm run check
npm run build
npm run test:smoke
```

`check` runs strict TypeScript, Vitest including real local D1, and the frontend build. `build` additionally performs a Wrangler bundle dry run; it does not deploy. Tests require local loopback sockets for Miniflare. `test:smoke` expects a built frontend, starts an isolated Wrangler runtime with a temporary token and storage, applies the actual migration, exercises the API, a real local Workflow and SQLite agent, and tests the browser at desktop/mobile widths. It removes temporary storage on exit. It does not access normal `.wrangler` data or remote services.

macOS defaults to installed Google Chrome; set `CHROME_PATH` to another compatible executable. On Linux, run `npx playwright install --with-deps chromium` first. `EDGEOPS_BROWSER=0 npm run test:smoke` runs API/runtime checks without the browser. Screenshots are written to ignored `test-results/`. CI runs the same checks; no CI run or deployment has been claimed locally.

## UI components

The dashboard uses shadcn/ui with Tailwind CSS v4, Radix UI and Lucide icons. Its light workspace shell, emerald accents, locally bundled DM Sans, sidebar navigation, metric cards, probe chart, service table, activity feed and investigation drawer follow the supplied “EdgeOps AI Operations Dashboard.zip” reference. Overview metrics/chart use the latest scoped D1 probe samples; request telemetry and unimplemented pages are explicitly unavailable or planned. Connection credentials are entered in a dialog and stay in page memory. Component sources live in `web/src/components/ui/`, shared classes in `web/src/lib/utils.ts`, and theme tokens in `web/src/styles.css`. `components.json` configures the registry and aliases; use `npx shadcn@4.23.0 add <component>` to add components. Carbon and Sass are removed.

## State, retries and costs

- D1 owns seeded services, fixture samples, incidents, investigations, evidence, outbox, inference reservations and safe audit records. Every repository query includes its scope. A unique index permits one active incident per service.
- Fixture detection requires three valid samples and at least two failures. Unknown samples do not satisfy the minimum. Healthy/insufficient scenarios create no incident and perform no inference. Fixed fixture event timestamps never represent live availability.
- Detection and dispatch intent are one D1 batch. `Idempotency-Key` is required; reusing it for another scenario returns 409. Concurrent detections attach to one active incident.
- The outbox uses the investigation ID as the Workflow instance ID. Dispatch failures remain pending; Cron reconciles up to ten pending entries every five minutes. An existing Workflow is attached after a crash between creation and marking the outbox sent. No provider HTTP probes run on Cron yet.
- Workflow steps persist evidence first, then a validated summary. Evidence writes and completion are idempotent. The model receives only allowlisted synthetic fields, no browser credentials or arbitrary text, and no tool executor. Invalid citations/schema produce a partial result.
- A D1 atomic reservation bounds calls globally per deployment/day (UTC), including retries and fixture calls. Default 10, configurable 0–100; 0 disables inference. This is a call cap, not a currency budget. At most 1,000 output tokens, 12,000 evidence characters, and a 20-second remote-call timeout. An ambiguous completed AI request is not billed again automatically: replay reports a partial/reserved result. D1 outages can still leave a run requiring operator inspection; automatic stalled-run repair is pending.
- The agent owns a maximum 20 persisted conversation messages. Its authenticated SSE response delivers complete persisted messages; incremental model token streaming, free-form questions and native tool calling are pending. Reading investigations never starts another reasoning loop.

## Real Workers AI and private deployment

Offline fixture summaries are explicitly labeled. The remote adapter uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, schema/citation validation and the same budget. A remote model invocation has **not** been verified with a Cloudflare account.

To exercise real inference locally, authenticate Wrangler (`npx wrangler login`), add `"ai": {"binding": "AI", "remote": true}` to your local Wrangler configuration, and set `AI_MODE="remote"` in `.dev.vars`. Keep synthetic inputs and a small daily limit. Workers AI requires remote account access and may incur usage. Existing saved investigations are deliberately reused; use isolated local storage or reset local state for a new inference check.

Private deployment requires a separate configuration with unique D1/DO/Workflow bindings, actual D1 ID, `MODE=private`, `AI_MODE=remote`, Access team issuer, audience and an explicit comma-separated subject allowlist (`ACCESS_SUBJECTS`). Never deploy the development file as a live or public demo configuration. The backend verifies RS256 signature, issuer, audience, expiry, issued-at and subject; browser writes require same origin. Raw `/agents/*` routes are unavailable. Static frontend files contain no operational data; API data is always authenticated.

Public demo sessions, live providers, SSRF-safe external probes, operator resolution/recovery, confirmed knowledge, retention/purge/export, native model tool calling, incremental inference streaming, provider quota/backoff and private live pilot remain required backlog work. No production-ready security or release claim is made. Do not connect customer telemetry before those controls and the read-only integration gates are implemented.

To reset development only, stop Wrangler and remove its generated `.wrangler/state` directory, then rerun `db:migrate`. This deletes local D1 and agent/Workflow history; do not apply it to shared or remote state.
