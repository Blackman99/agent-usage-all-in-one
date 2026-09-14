# Quota buckets may store a used amount without becoming cost

- Status: accepted
- Date: 2026-09-13

## Context

Quota buckets already carry `usedPercent`, `limitAmount`, and `limitCurrency`.
The glossary also describes usage and remaining amount. Cursor `/usage`
On-Demand prints `$used / $limit` (fixed) or used dollars with no limit
(unlimited). Those figures are a spend-limit window, not an invoice. Cost
records remain actual, subscription, reported-estimate, or retail-equivalent
(ADR 007). Storing On-Demand only as a derived percent would drop cents and
could not represent unlimited used dollars. Storing it as a cost record would
relabel a limit window as money.

## Decision

Add optional `usedAmount` on quota buckets, same currency as `limitAmount`.
Percent, when both used and limit are present and limit is positive, is
derived from those amounts and clamped. Do not reverse a percent into a limit.
Existing providers leave `usedAmount` null. Cursor On-Demand uses it; Included
does not. Disabled on-demand may keep a used amount if the screen states one,
with `fallbackStatus: disabled`. Unavailable on-demand omits the bucket.

## Consequences

- SQLite `quota_buckets` gains a nullable `used_amount` column via the existing
  expand-contract `ALTER TABLE` path. Old rows stay valid.
- Workbench cost metrics still ignore quota used amounts.
- Quota rows on the dashboard and CLI display used and limit amounts when
  present. A missing percent is shown as unavailable, not 0%. Disabled
  on-demand uses the Provider's off wording. Calendar-day reset wording is a
  separate reset label, not `resetsAt` and not the existing `status` field
  (OpenCode already uses `status` as a health string).
