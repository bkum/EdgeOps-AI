# ADR-0001: Cloudflare-native TypeScript stack

Status: Proposed. Date: 2026-11-24.

## Context

The assignment requires AI, coordination, user input and memory. The pilot needs low operational overhead and a coherent implementation language.

## Decision

Use TypeScript, React/shadcn/ui, Hono, Workers Static Assets, Agents SDK/Durable Objects, Workers AI, Workflows and D1. Start with the Llama 3.3 model candidate and verify its inference/tool behavior. Wrangler and GitHub Actions are planned delivery tools.

## Alternatives and consequences

Go microservices introduce additional deployment boundaries without a current requirement. An external LLM remains possible if Workers AI fails an evaluated need, but would add credentials, privacy and cost considerations. Cloudflare-native components simplify delivery while creating platform dependency. SDK/API changes require a tested version pin.

## Validation

Foundation spike must prove streaming input, real inference, persisted agent state, D1 access and durable Workflow resume in the selected account before acceptance.
