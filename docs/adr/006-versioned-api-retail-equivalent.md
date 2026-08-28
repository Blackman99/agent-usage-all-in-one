# ADR 006: Versioned API retail-equivalent derivation

- Status: accepted
- Date: 2026-08-28

## Context

Subscription-agent Token observations are not bills, but users want to compare
their observed use with public API list prices. Provider-reported estimates,
actual API charges, and fixed subscription fees already have different meaning.
Reusing any of them as a retail equivalent would make totals impossible to
audit. Using today's price for old observations would also rewrite history.

Model names, aliases, context tiers, and Token categories are not universally
identifiable. Anthropic, for example, publishes different cache-write rates for
5-minute and 1-hour lifetimes. Claude telemetry exposes cache-creation Tokens
without proving that duration, so choosing either rate would be a guess.

## Decision

Use a bundled, read-only, versioned price catalog. Each entry is scoped by
Provider and billing domain and records a canonical model, reviewed aliases,
currency, effective interval, context tier, per-million Token-kind rates, and an
official source. Runtime code never scrapes a live pricing page.

Derivation normalizes each observation, resolves one catalog entry effective at
the observation timestamp, and creates one `retail-equivalent` cost record per
observation and price entry. The stable identity contains both source
observation id and price entry id. The record stores its canonical model, source
observation, calculated time, priced Token count, exact line items, and immutable
price snapshot.

Every non-zero, non-overlapping Token category must have an applicable rate and
the line-item Token count must equal recorded Tokens. Unknown models,
unclassified remainders, multiple active tiers, pre-effective observations, and
cache writes without a known lifetime remain unpriced. They reduce pricing
coverage but never create a zero amount.

The first tracer covers Claude Fable 5 standard API pricing from its 2026-06-09
availability date: input $10/MTok, output $50/MTok, and cache reads $1/MTok.
Cache-write pricing is intentionally unavailable until the observation proves
the 5-minute or 1-hour tier.

## Consequences

Retail equivalent remains an `estimate`-authority comparison value, separate
from Provider-reported estimates and actual charges. Repeated refresh and
restart upsert the same derived record. Selected-window summaries can sum USD
retail amounts and compute pricing coverage as priced Tokens divided by all
recorded Tokens. Future catalog expansion and retained-history backfill can use
the same effective-time and stable-identity rules.
