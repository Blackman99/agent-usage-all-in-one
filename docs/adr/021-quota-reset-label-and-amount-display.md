# Quota reset labels stay labels; quota rows show the quantities they have

- Status: accepted
- Date: 2026-09-13

## Context

Cursor `/usage` prints `Resets Sep 15` in UTC month-and-day with no year and
no time of day. Storing that as `resetsAt` midnight UTC (or local end-of-day)
would invent hour precision the source does not have. The existing `status`
field is OpenCode's quota health string, so it cannot hold reset prose.

Quota rows currently render only `usedPercent`. After ADR 020, On-Demand may
have used and limit amounts without a percent (unlimited) or with
`fallbackStatus: disabled`. Drawing those as `—%` plus an empty bar reads as
zero and hides a closed on-demand window.

## Decision

Add an optional quota reset label: the Provider's printed reset wording when
it is not an instant. `resetsAt` stays null unless the source states an
instant. Do not invent `windowDurationMinutes` for a monthly billing period.

Quota-row display is shared across Providers. It shows used and limit amounts
in the bucket currency when present, percent when present, and the Provider's
disabled on-demand wording when `fallbackStatus` is disabled. A missing
percent is not a zero bar. The Cursor Provider listing waits for this display
and the `/usage` connector together.

## Consequences

- SQLite `quota_buckets` gains a nullable reset-label column via expand-contract.
- Quota timeline keeps skipping samples that have no `usedPercent` and no
  `resetsAt`; that is correct for calendar-day Cursor windows.
- CLI summaries must not print `?% used` for amount-only or disabled buckets.
