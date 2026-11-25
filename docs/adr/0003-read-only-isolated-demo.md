# ADR-0003: Read-only production and isolated demo

Status: Proposed. Date: 2026-11-24.

## Context

TrustPlate is a real application; evaluator access and reproducible incidents cannot expose customer data or cause outages.

## Decision

Live provider credentials permit telemetry reads only. The model can change authorized EdgeOps records but cannot modify monitored infrastructure. A separate demo deployment uses synthetic provider adapters with real inference and persistence, separate secrets/storage, session isolation and quotas.

## Alternatives and consequences

Production incident simulation is unsafe and unreliable as an evaluator experience. A fully mocked AI demo cannot demonstrate the assignment's actual runtime. Maintaining shared adapter contracts with separate fixtures adds tests but keeps demo behavior representative. Future approved remediation needs a separate ADR and executor design.

## Validation

Prove no demo/live binding crossover, no mutating provider tools, no secret leakage and no shared evaluator memory across sessions.
