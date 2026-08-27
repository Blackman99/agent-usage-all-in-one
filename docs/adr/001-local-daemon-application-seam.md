# ADR 001: Local daemon behind an application seam

- Status: accepted
- Date: 2026-08-28

## Context

The product needs one consistent behavior across the browser dashboard, CLI, background collector, connector ingestion, exports, and tests. Direct database or connector access from those adapters would duplicate security, reconciliation, and failure-handling policy.

## Decision

`UsageApplication` is the use-case boundary. The loopback HTTP server, CLI, scheduler, and browser call it; connectors return normalized value objects and never write SQLite directly. A repository port owns persistence. The daemon binds only to loopback and authenticates browser and CLI callers separately.

## Consequences

Business behavior is testable without a real HTTP process, while HTTP/CLI/browser tests still verify adapter parity. Connector failures remain isolated. The daemon is a required runtime dependency for CLI status and doctor commands, but stale or missing daemon state has one explicit recovery path.
