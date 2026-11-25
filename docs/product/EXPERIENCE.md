# Dashboard and interaction expectations

Workspace navigation: Overview, AI Assistant, Services, Incidents, Deployments, Logs, Usage & cost. Configuration: Integrations, Agent memory, Settings. P1/P2 pages should be hidden or explicitly labeled planned until implemented.

Application and environment selection scopes the whole view. This is an EdgeOps model, not TrustPlate restaurant account/outlet switching. Always display demo/live mode. Never reuse a public demo session for private live access.

Overview: availability derived from probe samples, request count from provider telemetry, provider p95, 5xx rate, service status, freshness and active incidents. Explain windows, denominators and sampling. Never seed production cards with illustrative metrics.

Chat: streaming response, evidence drawer, tool progress, cancel, reconnect and explicit missing-data states. Incident detail: trigger, timeline, ranked hypotheses, recommendation, recovery status, operator-confirmed cause. Memory: provenance, confirmation status, correction/deletion actions and scope.

Use shadcn/ui components, keyboard navigation, accessible labels, meaningful focus order and text alongside status colors. Support loading, empty, stale, unauthorized, partial and failed states. Initial desktop dashboard should remain usable on a narrow viewport.
