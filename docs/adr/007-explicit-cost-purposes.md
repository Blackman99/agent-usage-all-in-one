# ADR 007: Explicit cost purposes and legacy migration

- Status: accepted
- Date: 2026-08-28

## Context

The original `estimate` cost kind combined unrelated meanings: a value reported
by an official client, an Agent Usage retail calculation, and OpenCode Go quota
allowance consumption. The five-hour, weekly, and monthly Go allowances overlap,
so treating all three as time-range costs inflated totals. A fixed subscription
fee also cannot be honestly allocated to a Token observation, model, session, or
day without a separate allocation policy.

Existing databases may contain generic `estimate` rows. Some rows carry enough
evidence to classify, while others do not. Migration must not guess merely to
make every historical amount fit a current category.

## Decision

New cost records use one mutually exclusive purpose:

- `actual`: an amount billed by the Provider account;
- `subscription`: a fixed subscription charge;
- `reported-estimate`: an amount reported by a Provider or official client;
- `retail-equivalent`: Agent Usage's versioned API-list-price calculation.

`legacy-unknown` is not a fifth purpose. It is a transitional evidence state for
an old generic estimate whose purpose cannot be proved. It remains visible and
exportable, but is excluded from all four purpose totals.

The expand-contract migration applies these rules in order:

1. A row with a source observation, priced Token count, line items, and price
   snapshot becomes `retail-equivalent`.
2. Official/local authority or a recognized Claude/OpenCode reported-cost source
   becomes `reported-estimate`.
3. Remaining generic estimates become `legacy-unknown` without changing their
   native amount, authority, source, or observation time.
4. Old `opencode-quota-estimate:*` rows are removed because their reconstructible
   evidence already lives in the corresponding quota bucket.

OpenCode Go allowance values remain quota context only. Claude OTLP and OpenCode
session costs carry their model and source observation. xAI account cost remains
`actual` and carries its model/source. Subscription persistence clears model,
usage-observation, Token line-item, and calculation allocation fields, and
subscription rows never enter daily cost buckets.

## Consequences

Dashboard, CLI, HTTP, and export can present the four purposes independently and
never invent a composite spend number. A null native amount stays unavailable.
Currency conversion affects only the comparison amount; missing or stale rates
do not hide the native record. Historical unknown-purpose evidence remains
auditable without contaminating any current purpose total.
