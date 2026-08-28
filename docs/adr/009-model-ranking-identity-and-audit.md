# ADR 009 — Keep model ranking identity and evidence source-scoped

## Status

Accepted — 2026-08-28

## Context

The dashboard needs a compact Top 5 model view while preserving enough detail
to explain every Token and retail-equivalent amount. A model name alone is not a
safe identity: two Providers or billing domains can expose the same string, and
their Token semantics, authority, and pricing evidence can differ. Unknown and
`all-models` observations still belong in the selected-window total, but putting
them in a model ranking would imply attribution that the source did not provide.

## Decision

Each ranking entry is identified by the tuple `(provider, billing domain,
model)`. The read model exposes all known entries plus two deterministic Top 5
orders:

- recorded Tokens descending, then the stable tuple identity;
- available API retail equivalent descending, then recorded Tokens and the
  stable tuple identity. Unpriced entries follow priced entries and retain an
  unavailable amount.

Unknown, absent, and `all-models` identifiers are aggregated per Provider and
billing domain into a separate unclassified section. They contribute to the
workbench total but never occupy a Top 5 place.

The model-detail read model retains the original observations, Token categories,
source-reported and derived totals, authority, time precision, observation time,
retail line items, and immutable price snapshots. Its trend uses the same
selected window as the workbench and retains gaps.

## Consequences

- Matching model-name strings never merge across source boundaries.
- Token ranking remains useful when pricing is incomplete.
- Retail sorting cannot imply that missing pricing means zero cost.
- Known model totals plus unclassified totals reconcile to recorded Tokens.
- UI drawers can explain the displayed result without a second data fetch or a
  model-name-only join.
