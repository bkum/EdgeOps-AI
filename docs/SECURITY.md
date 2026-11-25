# Security requirements

P0 launch gates. The foundation implements Access/local authentication, scope checks, synthetic input allowlists, citation validation, same-origin writes and daily inference call caps. Broader live controls remain pending; see [implemented limits](implementation/FOUNDATION.md).

- Authenticate with Cloudflare Access and validate JWT signature, issuer, audience and expiry on the backend, including agent/stream routes. Reject direct origin bypass and forged identity headers. Scope each resource query/tool independently.
- Separate live and public demo deployments, bindings, credentials and storage. Public demo needs per-session isolation, rate limits and resets; it has no live provider tokens.
- Use least-privilege telemetry credentials restricted to resources. Secrets belong in platform secret storage; D1 stores references only. Never accept a provider token from model text or return one to the browser.
- Permit only registered, validated probe hosts/routes. Require HTTPS, disallow private/loopback/link-local/metadata targets and userinfo; validate resolved destinations and each redirect or disable redirects. Protect against DNS rebinding and oversized/slow responses. Design against Workers runtime constraints and test the chosen enforcement mechanism before live probes.
- Redact authorization headers, cookies, tokens, OTPs, identifiers and customer fields before persistence, audit or inference. Prefer allowlisted structured fields over regex alone. Do not send TrustPlate food safety records or employee data to the model.
- Treat logs, runbooks and provider content as untrusted data. Schema-validate tool calls and outputs. Model instructions cannot override authorization, budgets or allowed operations.
- Do not expose shell, arbitrary SQL, generic outbound requests, or production mutation tools. Internal incident writes are scoped and auditable; future remediation needs a separate design.
- Bound ranges, result sizes, concurrency, retries, inference turns and daily budgets. A circuit breaker must preserve monitoring while stopping AI work.
- Audit actor, scope, action, time, run, safe argument summary and outcome; never full sensitive payloads. Validate browser output rendering against XSS and avoid rendering log HTML.
- Define retention, deletion, exports and restore procedures before live usage. Do not claim a geographic residency guarantee without verifying all provider processing/storage behavior.

Review checklist: auth bypass; horizontal scope access; demo/live crossover; SSRF and redirects; injected log commands; secret/PII leakage; duplicate workflow dispatch; budget exhaustion; secret rotation; retention and restore. See [threat model](THREAT_MODEL.md).
