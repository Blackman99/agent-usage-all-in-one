# ADR 013 — Keep model breakdown membership stable across metric orders

## Status

Accepted — 2026-08-29

## Context

ADR 009 introduced separate deterministic Top 5 orders for recorded Tokens,
displayable cost, and strict API retail equivalent. Once more than five known
model identities are present, each order can select a different fifth model.
Switching the dashboard metric then makes valid models appear and disappear even
though the selected time window and underlying observations did not change.

The breakdown is an audit surface, so compactness cannot hide a known model or
make the Token and cost views appear to disagree about available evidence.

## Decision

The model-ranking read model exposes every known `(provider, billing domain,
model)` identity in each deterministic order. Recorded Tokens, displayable cost,
and strict API retail equivalent control order and share calculations only; they
never control membership.

Unknown, absent, and `all-models` identifiers remain in the separate
unclassified section. Existing evidence, purpose, availability, Provider, and
billing-domain boundaries remain unchanged.

## Consequences

- Switching between Token and cost views preserves the complete model set.
- Low-cost, low-Token, and unpriced known models remain auditable.
- Long model histories may produce a longer breakdown list; the dashboard may
  add presentation-level navigation later, provided it does not silently change
  membership between metric orders.
- The Top 5 display limit in ADR 009 is superseded; its identity and evidence
  decisions remain in force.
