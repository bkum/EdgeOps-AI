# ADR-0002: Single agent with explicit state ownership

Status: Proposed. Date: 2026-11-24.

## Context

Interactive chat and durable investigations need consistent state across retries and disconnected browsers.

## Decision

One agent with bounded tools handles chat. Workflows own investigation step execution. D1 owns incident/evidence/confirmed knowledge records. Durable Object SQLite owns conversation state and derived progress. Use idempotent writes, an outbox and reconciliation between D1 and Workflow dispatch.

## Alternatives and consequences

A single request-bound reasoning loop loses progress on failures. Multi-agent coordination adds cost and ambiguity without a demonstrated need. Duplicating canonical incident state in D1 and Durable Objects creates divergence. Chosen boundaries require explicit synchronization and replay tests; no cross-store atomic transaction is assumed.

## Validation

Crash after persistence/before dispatch, duplicate detection, browser reconnect and stale operator actions must preserve one consistent run and timeline.
