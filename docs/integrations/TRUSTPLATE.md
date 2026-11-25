# TrustPlate pilot integration

Status: planned; no credentials or live data accessed during initialization. Do not infer actual hosting from public DNS alone.

| Candidate resource | Proposed signal | Required discovery |
| --- | --- | --- |
| trustplate.in | HTTP availability and latency | Hosting provider, safe path, expected response |
| app.trustplate.in | HTTP shell availability; later frontend telemetry | Hosting, authenticated routes, health semantics |
| api.trustplate.in | Safe API health, errors and latency | Actual backend runtime, health path, provider adapter |
| Cloudflare Workers | Aggregate metrics and sanitized error logs | Account/resource IDs, query API, permissions, retention, sampling |
| Supabase PostgreSQL | Connectivity and approved aggregate health | Region/project, supported telemetry endpoint, restricted credential |
| Supabase Auth | Aggregate failures and health | Safe source and data minimization |
| GitHub | Revision, deployment and failed build metadata | Repository access, workflow/environment mapping, webhook permissions |
| DNS/TLS | Later read-only drift/expiry checks | Zone permissions and supported certificate collector |

## Onboarding gates

1. Confirm topology and dependencies with the operator. Map every service to a provider resource; omit unsupported signals explicitly.
2. Establish synthetic fixtures and isolated development/demo bindings first.
3. Agree on safe idempotent GET health endpoints, expected status and timeout; never probe a write endpoint or synthetic customer login.
4. Inventory exact provider endpoints, token permissions, rate limits, retention and account-plan requirements. Verify each using a minimal read-only request.
5. Configure secrets outside Git. Do not use Supabase service-role access or database/customer-table queries as a telemetry shortcut.
6. Prove redaction before persistence/inference and prove that probe URL/redirect restrictions hold.
7. Start with HTTP probes, then add verified Cloudflare telemetry and deployment metadata. Externally hosted APIs require their own adapter.
8. Run a limited pilot; calibrate windows/sample thresholds, inspect budget counters and compare findings manually.

Credential matrix is deliberately pending: record provider, endpoint, exact read permission, resource restriction, owner, rotation date and test outcome in private operator configuration. Public docs contain no account IDs, private repository names, tokens or real logs.

No test-induced outage or incident simulation may run against TrustPlate production. Failures are demonstrated using fixtures/staging. Read-only provider access does not authorize telemetry export containing customer data.
