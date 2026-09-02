# ADR 009 — Keep model ranking identity and evidence source-scoped

## Status

Accepted — 2026-08-28. The Top 5 display limit is superseded by ADR 013. Audit
row delivery was revised on 2026-09-02: the aggregates are precomputed and the
rows became an explicit audit-evidence query.

## Context

The dashboard needs a compact Top 5 model view while preserving enough detail
to explain every Token and retail-equivalent amount. A model name alone is not a
safe identity: two Providers or billing domains can expose the same string, and
their Token semantics, authority, and pricing evidence can differ. Unknown and
`all-models` observations still belong in the selected-window total, but putting
them in a model ranking would imply attribution that the source did not provide.

## Decision

Each ranking entry is identified by the tuple `(provider, billing domain,
model)`. The read model exposes all known entries plus three deterministic Top 5
orders:

- recorded Tokens descending, then the stable tuple identity;
- available API retail equivalent descending, then recorded Tokens and the
  stable tuple identity. Unpriced entries follow priced entries and retain an
  unavailable amount;
- displayable cost descending, preferring API retail equivalent when it is
  available and otherwise using a Provider/client-reported estimate. Every
  amount retains its purpose, and reported estimates are never relabelled as
  retail equivalents. Shares for reported estimates are calculated only within
  the reported-estimate domain.

Unknown, absent, and `all-models` identifiers are aggregated per Provider and
billing domain into a separate unclassified section. They contribute to the
workbench total but never occupy a Top 5 place.

The model-detail read model retains the Token categories, source-reported and
derived totals, authority, time precision, observation time, and immutable price
snapshots. Its trend uses the same selected window as the workbench, reports its
own recorded Tokens per interval, and retains gaps.

Per-observation and per-cost audit rows are not part of that read model. A
ranking entry carries the aggregates the model detail displays — the
non-overlapping Token composition and the distinct price snapshots behind its
retail equivalent — computed where the rows are already in hand. The rows
themselves travel only on an explicit audit-evidence query, which the export path
uses. A displayed response therefore stays proportional to what it displays
rather than to the retained history: a 30-day window over three months of local
usage produced a response the JSON encoder could not even represent, and the
Dashboard only ever reduced those rows to the aggregates above.

## Consequences

- Matching model-name strings never merge across source boundaries.
- Token ranking remains useful when pricing is incomplete.
- Retail sorting cannot imply that missing pricing means zero cost.
- The cost ranking can include unpriced models without combining incompatible
  cost purposes into a single total or share.
- Known model totals plus unclassified totals reconcile to recorded Tokens.
- UI drawers can explain the displayed result without a second data fetch or a
  model-name-only join.
- Observation-level auditing stays possible through the export path, which is
  where a reader who wants every row already goes.
- A read model whose size tracks the display cannot be broken by how much history
  a user has retained.
