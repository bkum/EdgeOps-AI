# Source and verification notes

Primary product input: user-attached “Pasted text(8).txt”, EdgeOps AI planning proposal, reviewed 2026-11-24. This repository reorganizes that proposal into actionable requirements; illustrative metrics are not production data.

Official documentation checked 2026-11-24:

- [Agents](https://developers.cloudflare.com/agents/): durable agent identity, storage and communication primitives.
- [Workflows](https://developers.cloudflare.com/workflows/): durable steps, retries and waiting for external events.
- [Llama 3.3 model](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/): initial model ID `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; verify integration with the pinned SDK.
- [Workers observability](https://developers.cloudflare.com/workers/observability/): available categories of logs, metrics and telemetry; does not establish exact account permissions/API access.

Foundation implementation references checked 2026-11-24:

- [Workflow first build](https://developers.cloudflare.com/workflows/get-started/guide/): durable named steps and bounded retries.
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): signature/issuer/audience verification with `jose`.
- [Agents SDK configuration](https://github.com/cloudflare/agents/blob/main/docs/agents/configuration.md): SQLite Durable Object and compatibility bindings. Installed SDK declarations were also checked for `Agent`, `onStart`, `onRequest`, and `sql` integration.
- npm registry metadata and the lockfile pin the tested packages. These establish package compatibility, not Cloudflare account entitlement or remote inference success.

Implementation lookup starting points (revalidate when used):

- [D1](https://developers.cloudflare.com/d1/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Supabase documentation](https://supabase.com/docs)
- [GitHub REST documentation](https://docs.github.com/en/rest)

Pricing, future observability billing changes, unrestricted historical log access, and TrustPlate's actual infrastructure have not been verified. Do not carry the proposal's exact cost/entitlement claims into implementation without checking current official documentation and the selected account.

Operational implementation references checked 2026-11-24:

- [Workers GraphQL metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/): script-scoped adaptive sums and sampling caveats.
- [Workers Observability query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/): bounded script-filtered event metadata; raw sources are discarded.
- [Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/): structured response handling; raw JSON-mode token streaming is not assumed.
- [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/): real model integration and token usage.
- [GitHub deployment read API](https://docs.github.com/en/rest/deployments/deployments): deployment/read permission, revision, environment and status metadata.
- [Supabase project health](https://supabase.com/docs/guides/integrations/supabase-for-platforms): management health checks; no SQL or customer/auth-user access.
- [Workers fetch limits](https://developers.cloudflare.com/workers/platform/known-issues/) and [originless Workers boundary](https://blog.cloudflare.com/workers-environment-live-object-bindings/): approved hostname-only probing relies on the documented originless public-fetch boundary; arbitrary untrusted-host egress is not offered.

API contracts support the implementation design, not access to the user's unprovided account resources. Actual model/HTTP validation is recorded separately in [the measured record](../implementation/VALIDATION.md).

Checked 2026-11-25: [D1 supported SQL/PRAGMA statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/) and [SQL import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) informed the tested local restore rehearsal. The pinned Wrangler implementation was also inspected for its local export flags and temporary-config-directory persistence behavior.
