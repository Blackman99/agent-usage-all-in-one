# Cursor is one Provider; first billing domain follows `/usage`

- Status: accepted
- Date: 2026-09-13
- Revised: 2026-09-13 — first billing domain is `cursor-subscription`, not
  Cursor Models / Other Models. Those pools wait for a surface that states
  them separately.

## Context

Issue #18 tracks Cursor coverage. The Cursor IDE and the Cursor Agent CLI
(`agent`) are two surfaces of one product and draw from the same account-wide
monthly plan. Treating them as two Providers would duplicate quota. Copying
OAuth or calling undocumented `api2.cursor.sh` endpoints is forbidden
(ADR 003). Cursor's pricing page splits Cursor Models and Other Models, but
the first official-client surface (`/usage`) meters a single Included percent
plus On-Demand dollars. Auto and API on that screen are routing slices of
Included, not those two pools. Cursor Grok selected inside Cursor is not the
Grok Provider.

## Decision

One Provider `cursor` covers both the IDE and the Agent CLI. Cursor is admitted
as a Provider only when a connector can read provider-stated local evidence
without copying credentials. Presence of the CLI, the IDE, or
`agent about`'s `subscriptionTier` is not that evidence. Coverage may then
degrade per dimension.

The first billing domain is `cursor-subscription` and is
`summaryBillingDomainId`. Its display name is `Cursor subscription`, not the
`/usage` plan name. Cursor Models and Other Models are not minted as
empty sibling domains. On-demand spend is a quota bucket on that domain, never
a cost record. Auto and API rows are discarded, not stored as buckets. A Grok
Bot weekly window is out of this Provider unless the same official-client
surface states it.

The first official-client surface is an experimental scrape of Agent CLI
`/usage`. Tokens and history stay unavailable until a source-reported local
total exists. Expected coverage is quota only. Discovery is the `agent`
executable, not Cursor.app. The collector must not run `agent -p` to
manufacture turns.

## Consequences

- Dashboard headlines follow the plan `/usage` actually prints.
- Splitting Cursor Models vs Other Models later is an additive billing-domain
  change, not a Provider split, and requires a surface that states both pools.
- A later IDE connector searches additional local roots under the same Provider
  and the same first domain rather than minting a second identity.
- Quota scraped from `/usage` is account-wide and must keep that scope.
