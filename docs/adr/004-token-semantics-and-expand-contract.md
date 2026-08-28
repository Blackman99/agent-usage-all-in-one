# ADR 004: Token semantics and expand-contract migration

- Status: accepted
- Date: 2026-08-28

## Context

Provider sources expose incompatible Token shapes. Some provide only a total,
some provide categories, and some report reasoning or cache Tokens both as a
category and inside another category. Sources also differ in model attribution
and temporal precision. Adding every available field without a counting rule
would inflate totals and create false model or hourly precision.

Existing Connector snapshots and V1 rows contain `totalTokens` and category
fields but no explicit semantics. The contract must expand before individual
Connectors migrate so old data remains readable during rollout.

## Decision

Every observation is normalized to one `recordedTokens` value. A
`sourceReportedTotalTokens` value wins when present; otherwise a legacy
`totalTokens` value wins; otherwise the total is derived from categories. The
normalizer records that derivation. Category derivation adds reasoning only
when it is separate from output and adds each cache category only when it is
separate from input.

When a source total exceeds the categories, the remainder is unclassified. An
observation with no known model, or with `all-models` or `unknown`, is wholly
unclassified for model ranking. Such observations still contribute once to the
overall and time-based totals.

The contract records event, hour, day, billing-period, or unknown time
precision independently of its storage timestamp. Legacy observations default
to unknown precision, known model attribution unless their stored model is a
recognized aggregate placeholder, and the historical semantics of reasoning
included in output with cache reads and writes separate. Usage scope is also
independent evidence: account-wide, this Mac, or unknown. Legacy rows default
to unknown rather than inferring scope from authority.

Telemetry also declares aggregation temporality. Delta observations can be
stored by stable event identity and added across distinct times. Cumulative
observations are rejected unless a Connector implements an explicit
reconciliation boundary; treating them as deltas would inflate history.

SQLite migration is additive and idempotent. It adds evidence columns with
honest defaults, backfills only recognized aggregate model placeholders, and
preserves the observation id, authority, and observed timestamp. Overview,
history, HTTP, and export expose the expanded evidence while existing Token
totals remain available during the migration phase.

## Consequences

Token totals cannot be reconstructed by summing every exposed field. Consumers
use `recordedTokens` for totals and category fields for breakdown evidence.
Model rankings omit unattributed usage and must disclose classification
coverage. Day and billing-period observations may appear in wider time views
without being presented as event-level data. ADR 005 removes the legacy
`totalTokens` Connector input after all production sources migrated, while
retaining V1 database compatibility evidence.
