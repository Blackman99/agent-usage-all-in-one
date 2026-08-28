# ADR 008: Token and money workbench read model

- Status: accepted
- Date: 2026-08-28

## Context

Provider cards answer quota and connection questions, but cross-Provider Token
and money analysis needs a separate read model. Adding actual charges, client
estimates, retail equivalents, and subscriptions into one total would erase the
purpose boundary established by ADR 007. A trend also cannot silently connect
intervals with no observations or combine Grok Build/SuperGrok with xAI API.

## Decision

`UsageOverview.workbench` is an application-owned read model for the selected
window, time zone, and comparison currency. It contains:

- one recorded-Token total;
- separate actual, reported-estimate, and retail-equivalent metrics;
- native amounts, converted amounts, authority, observation time, amount
  coverage, pricing coverage, and exchange-rate evidence;
- 24 hourly intervals for the 24-hour view and 7 or 30 daily intervals for the
  longer views; and
- per-Provider, per-billing-domain trend segments with explicit gaps and source
  time precision.

Subscription costs do not enter workbench metrics or trends. They remain in the
owning billing-domain detail. A comparison metric is available only when every
record contributing to it has a known amount and a valid conversion. Partial or
unavailable conversion never hides the native-currency evidence. Positive
sub-cent values retain sufficient display precision to remain non-zero.

## Consequences

The Dashboard can switch between CNY and USD and between Token and retail
equivalent trends without recomputing business rules in the browser. The HTTP
response and an accessible table expose the same bucket and evidence structure.
Gaps, coarse time precision, and billing-domain separation remain inspectable
instead of being smoothed into a misleading chart.
