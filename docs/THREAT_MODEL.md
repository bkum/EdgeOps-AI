# Threat model

Assets: provider credentials, operational topology, incident evidence, chat history, confirmed knowledge, inference budget and production availability. Boundaries: browser/API, API/agent, agent/tools, workflow/stores, adapters/providers, public demo/live.

| Threat | Impact | Control | Verification |
| --- | --- | --- | --- |
| Forged Access identity/origin bypass | Unauthorized diagnostics | JWT validation and protected routes | Invalid signature/audience/expired and direct-route tests |
| Cross-environment IDs | Data disclosure | Scope checks in repositories/tools | Swap IDs in API, chat, evidence and memory |
| Malicious telemetry instructions | Exfiltration or privilege escalation | Data-only inputs, tool allowlist, server policy | Inject adversarial log/runbook fixtures |
| Probe SSRF/DNS rebinding | Internal access | Registered HTTPS targets, address/redirect checks | Local/private targets, alternate IP notation and rebinding tests |
| Tokens/PII in logs | Confidentiality breach | Structured minimization and redaction before all stores | Seed canary secrets; assert absent downstream |
| Repeated trigger/retry | Duplicate incident or side effects | Unique keys, outbox, replay-safe writes | Concurrent detection and crash-after-write tests |
| Demo abuse | Cost spike or live exposure | Separate deployment, quotas, no live bindings | Repeated runs, session crossover and config tests |
| Provider outage or sparse samples | False diagnosis | Coverage/freshness/unknown states | Timeout, 403, 429, stale/low-volume fixtures |
| Poisoned historical lesson | Repeated incorrect recommendation | Confirmation provenance, correction/deletion | Unconfirmed lesson cannot become established fact |
| Rendered log HTML | Browser code execution | Escape untrusted output and restrict links | XSS fixture tests |

Residual risks: redaction may miss unexpected provider fields; providers can report incomplete data; model conclusions may be wrong; EdgeOps shares a platform failure domain with monitored Workers. Require operator judgment and an independent provider-status check. Broader production rollout needs review of the implemented controls, not just this document.
