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

The catalog covers Claude Fable 5, the current OpenCode Go models with published
rates, Grok Build 0.1, and Grok 4.6. Fixed model rates can price coarse history
when every Token kind is known. Request-length tiers require event-level delta
evidence; OpenCode peak/off-peak tiers additionally require an exact event time.
Day and billing-period aggregates therefore remain unpriced when they span a
possible tier boundary. Claude cache writes remain unavailable until the
observation proves the 5-minute or 1-hour lifetime.

OpenCode Go asks the official CLI for its local database path, then reads
categorized, completed assistant-message usage through a read-only SQLite
connection. The adapter discards source message identifiers after deriving a
stable hash, marks each request as event-level delta evidence, and keeps the
client-reported estimate separate from the calculated retail equivalent. Missing
cost omits that estimate; a missing required Token category fails closed instead
of becoming zero. A successful authoritative read reconciles disappeared rows
and removes the earlier model/day import in one transaction. Existing request
rows retain their immutable retail price snapshots, while a failed read never
erases cached history.

On startup, retained raw observations pass through the same derivation path.
Derived inserts use immutable stable identities and ignore a conflict with an
already recorded retail snapshot. A reviewed price change must use a new catalog
entry and effective interval; changing an in-memory rate under an existing entry
cannot rewrite prior amounts.

## Consequences

Retail equivalent remains an `estimate`-authority comparison value, separate
from Provider-reported estimates and actual charges. Repeated refresh, restart,
and retained-history backfill produce the same derived record. Selected-window
summaries sum USD retail amounts and expose priced, unpriced, and recorded Tokens
so pricing coverage is independently recomputable. Provider and billing-domain
scoping prevents identical aliases from merging Grok Build/SuperGrok with xAI
API or any other unlike source.
