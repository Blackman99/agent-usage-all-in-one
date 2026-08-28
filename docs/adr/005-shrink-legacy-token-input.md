# ADR 005: Shrink the legacy Token input contract

- Status: accepted
- Date: 2026-08-28

## Context

ADR 004 expanded Token observations with source totals, category semantics,
model attribution, time precision, usage scope, and aggregation temporality.
Codex, Claude Code, OpenCode Go, Grok Build, and xAI API now emit that expanded
contract. Keeping the ambiguous `totalTokens` Connector input would allow new
code to bypass those semantics and silently restore legacy counting behavior.

Existing V1 databases still contain only `total_tokens` and category columns.
Removing their storage or read path would lose the original source evidence and
break direct upgrades, history, CLI output, export, retention, and compaction.

## Decision

Remove `totalTokens` from the production `UsageObservation` input. New
observations use `sourceReportedTotalTokens` when the source explicitly states a
total; otherwise normalization derives the recorded total from categories and
their declared semantics.

Keep the SQLite `total_tokens` column, the `legacy-total` derivation value, and
the additive V1 migration. They are durable compatibility evidence for stored
rows, not a supported Connector write shape. The export field named
`totalTokens` also remains as a stable summary alias for consumers.

xAI invoice observations use official-account authority, account-wide scope,
billing-period precision, and delta identity per invoice and model. They do not
claim request-event precision. A time window that contains cost activity but no
invoice observation reports no Token observations for that window.

## Consequences

Production Connectors cannot add a raw total without declaring whether it is a
source total or categorized usage. Historical V1 rows still restart and render
idempotently with `legacy-total` evidence. The compatibility boundary is now
limited to persistence and export instead of leaking back into Connector code.
