# Agent Usage Domain Context

## Product boundary

Agent Usage is a local-first, open-source usage center for individual
developers. The macOS-first product launches a local web dashboard from one
command and exposes the same core summary through a CLI. It never switches an
agent automatically and does not upload private usage data or telemetry to a
product-owned service.

The initial products are Codex, Claude Code, OpenCode, Grok, dsh, and Antigravity.
OpenCode Go quota and OpenCode local history use separate internal Provider
identities: Go represents subscription allowance only, while local history
represents every completed request made through OpenCode regardless of its
underlying Provider. Grok is one top-level provider with two independent
billing domains: Grok Build/SuperGrok subscriptions and the xAI API. Their usage
and costs must never be merged. dsh (DeepSeek Harness) is one Provider covering
every profile of one dsh home, including terminal front ends composed on it,
which keep no usage of their own; it reports Tokens and history with no quota
window, and its billing domains are dsh provider route keys, with
`deepseek-official` as the deployment default and summary domain. Antigravity
(Google Antigravity) is one Provider covering both CLI and IDE/desktop profiles;
it reports source-recorded Tokens and turn history with no live quota window, and
its primary billing domain is `code-assist-subscription`.


## Ubiquitous language

- **Provider**: A top-level agent product shown in the dashboard, such as Codex
  or Claude Code.
- **Billing domain**: An independently metered subscription or pay-as-you-go
  account within a provider.
- **Connector**: A read-only adapter that discovers and normalizes one provider
  or billing domain without leaking its credentials.
- **Account**: The provider identity associated with collected usage. The first
  release supports one active account per provider while retaining an account
  identifier in stored records.
- **Quota bucket**: A provider-defined usage window with its original label,
  scope, usage, remaining amount, and reset time. Quota buckets are dynamic and
  are never hard-coded as fixed columns.
- **Usage observation**: A time-stamped token or activity measurement collected
  from an official account, official client, or local telemetry source.
- **Source-reported Token total**: A total stated by the source itself. It is
  preserved as evidence and takes precedence over a locally derived total.
- **Recorded Tokens**: The one non-overlapping Token total used by summaries.
  New observations use the source-reported total when present, otherwise the
  sum of categories under the observation's declared Token semantics. Upgraded
  database rows may retain a legacy total as historical evidence.
- **Unclassified usage**: Recorded Tokens that cannot be assigned honestly to
  both a known model and known categories. `all-models`, `unknown`, and absent
  model identifiers are unclassified and never enter model rankings.
- **Reconciled remainder**: An estimate equal to an official account-wide total
  minus the complete local model-attributed subset for the same Provider day.
  It is explicitly derived, keeps `estimate` authority, and is never represented
  as a source-reported total.
- **Token semantics**: Source metadata declaring whether reasoning is included
  in output and whether cache reads and writes are included in input or are
  separate. Missing legacy metadata uses the historical interpretation:
  reasoning included in output, cache reads and writes separate.
- **Time precision**: The smallest time unit supported by an observation:
  event, hour, day, billing period, or unknown. A precise timestamp does not
  upgrade a source's actual precision.
- **Usage scope**: The population represented by a Token observation:
  account-wide, this Mac, or unknown. Local authority does not by itself prove
  that a value is limited to one machine.
- **Aggregation temporality**: Whether a telemetry observation is a delta for
  one interval, a cumulative running total, or unknown. Only delta telemetry is
  additive across observation times.
- **Cost record**: An amount with one explicit purpose: actual billed cost,
  fixed subscription cost, Provider/client-reported estimate, or calculated API
  retail equivalent. These purposes remain separate.
- **Legacy unknown cost**: Transitional evidence from an old generic estimate
  whose purpose cannot be proved. It is not a fifth purpose and does not enter
  any of the four current purpose totals.
- **Reported estimate**: A monetary estimate stated by a Provider or official
  client. It keeps its upstream authority and is never relabelled as an actual
  charge or as Agent Usage's retail calculation.
- **API retail equivalent**: Agent Usage's model-level estimate of what eligible
  Tokens would cost at the public API list price effective at observation time.
  It is comparison evidence, not a bill or subscription allocation.
- **Price snapshot**: The immutable catalog entry, official source, version,
  context tier, currency, effective interval, and Token-kind rates used by one
  retail-equivalent derivation.
- **Pricing coverage**: Priced Tokens divided by recorded Tokens for the selected
  window. Priced, unpriced, and recorded Token counts remain available so the
  ratio can be recomputed. It is independent from classification and Provider
  data Coverage.
- **Token and money workbench**: The selected-window read model that keeps
  recorded Tokens, actual cost, reported estimate, and API retail equivalent
  separate while exposing Provider and billing-domain trend intervals.
- **Model ranking identity**: The tuple of Provider, billing domain, and model.
  Matching model names from different identities remain separate ranking rows.
- **Model ranking**: The selected-window complete set of known model identities,
  exposed in deterministic recorded-Token and explicitly labelled cost orders.
  Switching the order never changes which known models are present. Cost order
  prefers available API retail equivalent and otherwise uses a Provider/client-
  reported estimate without relabelling its purpose. A strict API retail-
  equivalent order remains separately available in the read model. Unclassified
  usage remains visible beside the ranking and never occupies it.
- **Plan subscription**: A user-declared recurring price for one billing domain:
  amount, currency, and billing period. It is a local declaration, not collected
  evidence, and it never becomes a Cost record.
- **Plan catalog**: Built-in preset plan prices. Each preset carries the official
  page and retrieval date it was read from; a plan whose official price cannot be
  read is absent rather than guessed. Every preset remains editable because
  regional pricing, annual billing, and seats are not represented.
- **Window plan cost**: One plan price prorated at read time over the selected
  window, using the average length of that plan's own billing period. It is a
  comparison denominator, never a stored amount.
- **Plan value ratio**: API retail equivalent divided by window plan cost for one
  subscription billing domain. It compares two cost purposes without combining
  them.
- **Effective unit price**: Window plan cost divided by that billing domain's
  recorded Tokens. **Retail unit price** is its API retail equivalent divided by
  its priced Tokens. The two answer what a Token cost and what it was worth.
- **Renewal date**: A user-declared date on which a plan subscription renews.
  Any past or future renewal resolves the same current billing period; without
  one the period stays unknown.
- **Billing period to date**: One subscription's own current period measured from
  its start to now, against the whole period price. It answers whether that
  period has paid for itself yet and is not comparable across Providers sitting
  at different points in their cycles.
- **Break-even pace**: The share of the period price earned back so far read
  against the share of the period elapsed. Ahead of that pace the period is on
  track to pay for itself.
- **Trend gap**: An hourly or daily interval with no Token observation. It stays
  visibly discontinuous; cost evidence does not fabricate a Token observation.
- **Data authority**: The provenance level of a value: official account,
  official client, local observation, estimate, or unavailable.
- **Freshness**: The age and last-success state of a connector result. Stale
  freshness is an internal automatic-retry signal, not a user-action state.
- **Coverage**: The independent availability state for quota/reset, tokens,
  actual cost, and history. Coverage is never compressed into one score.
- **Recommendation**: A transparent, reasoned suggestion about which agent has
  healthier capacity. Recommendations never perform an automatic switch.
- **Collector**: The optional local background process that refreshes connectors
  and persists observations for 24-hour, 7-day, and 30-day views.
- **Processing module**: One independently observable background unit: connector
  discovery, Provider usage, model pricing, or retention. A module never blocks
  loopback-server readiness or hides cached results from another module.
- **Hard rebuild**: An explicitly confirmed, asynchronous recovery operation that
  ignores optimization caches and recalculates derived evidence. It is not the
  normal startup or refresh path.
- **Degraded state**: A truthful partial result that retains the provider card,
  explains the missing field, and offers a recovery action.

## Invariants

1. Source priority is official account, then official client, then local
   observation, then estimate.
2. Values from overlapping sources are reconciled, not added together. One
   Provider day is covered by exactly one side: the official account-wide total
   plus its reconciled remainder while that total still contains the local
   observations, otherwise those local observations alone. An official total
   smaller than the local observations recorded for the same day is not a
   superset of them and never replaces them. A day total is stored only once it
   is settled and reconciled: a day still running, or one an upstream aggregate
   has not finished, is not evidence for that day.
3. Local evidence is read from every location its Provider keeps it in. A
   Provider that moves finished transcripts into an archive keeps them as
   evidence, and history that ages out of a live directory is never read as a
   drop in usage.
4. Unknown cost is never represented as zero.
5. Provider-native quota labels and windows are preserved.
6. One connector failure cannot make other providers unavailable.
7. Credentials stay in the system keychain or their owning official client and
   never appear in logs, exports, or the usage database.
8. Every displayed number carries its data authority and observation time.
9. Each observation contributes exactly one recorded Token total. Category
   fields and source totals are evidence for that total, never additive totals.
10. Recorded Tokens equal classified plus unclassified Tokens; a source total
    larger than its categorized fields leaves an explicit unclassified remainder.
    Partial classification keeps every known category visible; the unclassified
    remainder never makes those known values unavailable.
11. `all-models` and unknown-model observations contribute to overall and time
    summaries but never to per-model rankings.
12. Migration preserves observation identity, authority, and observed time and
    does not invent source totals, model attribution, or time precision.
13. Account-wide and this-Mac observations retain their scope through history,
    CLI output, and export; unlike scopes are never presented as interchangeable.
14. Cumulative telemetry is rejected before persistence unless a Connector has
    an explicit non-overlapping reconciliation algorithm; it is never summed as
    though it were delta data.
15. Production Connectors never write the legacy Token-total input. The SQLite
    compatibility column and `legacy-total` derivation remain read-only migration
    evidence so a V1 database can upgrade without losing or duplicating usage.
16. Retail-equivalent records are derived only from a known Provider, billing
    domain, model, non-overlapping Token kinds, context tier, and price effective
    at the observation time. Missing or ambiguous evidence remains unpriced.
17. Repeating collection, restart, or price derivation for the same observation
    and price version is idempotent. Line items reconcile exactly to the stored
    retail amount and never mutate actual, subscription, or reported estimates.
18. Unknown retail equivalent is unavailable, never zero. Pricing coverage may
    be zero when Tokens were observed but none were eligible for pricing.
19. Context-sensitive pricing requires observation evidence at the same
    granularity as the Provider rule. Day or billing-period aggregates cannot
    select request-length or time-of-day tiers. Grok Build/SuperGrok and xAI API
    aliases, amounts, and coverage remain isolated by billing domain.
20. Retained observations may be backfilled with the catalog entry effective at
    their observation time. Once recorded, a retail price snapshot is immutable;
    a later catalog release adds a new version instead of rewriting history.
21. Actual, subscription, reported-estimate, and retail-equivalent are mutually
    exclusive cost purposes. No aggregate combines unlike purposes.
22. OpenCode Go allowance values belong to quota context. Five-hour, weekly, and
    monthly overlapping allowance values never become time-range cost records.
23. Fixed subscription cost is billing-domain evidence only. It is never
    allocated to a Token observation, model, session, or daily bucket.
24. Workbench cost metrics include only actual, reported-estimate, or
    retail-equivalent records. Subscription and legacy-unknown evidence never
    enter those metrics or their trends.
25. A converted workbench amount is available only when every contributing
    record has a known native amount and valid conversion. Missing or stale CNY
    evidence cannot hide the original USD or other native amount.
26. Workbench trend segments retain Provider and billing-domain identity. An
    interval without observations remains a gap, and day or billing-period
    precision remains explicit in visual and accessible output.
27. Model rankings use Provider, billing domain, and model as their identity.
    Equal values are ordered by that stable identity, never by collection order.
28. Token, cost, and retail-equivalent ranking orders contain the same complete
    set of known model identities. Token order includes known unpriced models and
    labels retail equivalent as unavailable. Retail order puts priced models
    first and never represents an unavailable amount as zero.
29. Headline-included known-model Tokens plus headline-included, separately
    disclosed unclassified Tokens reconcile to the workbench recorded Token
    total for the selected window. Sibling-domain rows are separately marked and
    excluded from that reconciliation.
30. Model details present aggregate Token, cost, authority, precision, time, and
    trend summaries without exposing observation or pricing audit tables. The
    underlying observation-level Token evidence and immutable price snapshots
    remain retained in the local domain and export paths without joining model
    names across sources.
31. A Provider with independent billing domains declares one
    `summaryBillingDomainId`. Provider headlines and workbench scalar metrics
    aggregate only that domain. Sibling-domain Token and cost evidence remains
    separately identified in the model-cost view's trends and rankings, with an
    explicit marker that it is not part of the headline total or its percentage
    denominator. Provider billing-domain tabs remain quota and connection views;
    they do not duplicate Token or cost detail.
32. Agent usage cards never render technical diagnostic or recovery banners.
    Stale, unavailable, and timeout evidence from freshness, health, or connector
    diagnostics triggers one automatic refresh for that unchanged evidence.
    Repeated identical evidence does not create a refresh loop; a changed or
    recovered state may trigger a later retry. Rate-limited evidence stays under
    the existing Provider backoff and never forces an immediate retry.
33. Automatically managed stale, unavailable, timeout, and rate-limited
    diagnostics remain internal. Failures that require a human action, such as
    installing a client, connecting an account, signing in again, or upgrading
    an unsupported integration, remain available only in connection management
    and Settings diagnostics; they never interrupt the usage-first dashboard.
34. Loopback health and cached reads become available before discovery or data
    processing. Each processing module reports its own state and failure boundary.
35. Normal startup reuses versioned, disposable optimization caches. Cache keys
    do not persist personal transcript paths, and cache corruption never changes
    source evidence or prevents a source scan.
36. A hard rebuild requires explicit user confirmation, runs asynchronously, and
    may delete only recalculable retail-equivalent evidence. It never deletes or
    relabels actual, subscription, or Provider-reported costs.
37. OpenCode local history includes every completed local request and retains the
    source `providerID` as part of model identity. It is never filtered to
    `opencode-go`, attributed to the Go subscription, or added to Go allowance
    values. A successful local scan retires legacy Go-attributed local rows; a
    failed scan retains the last successful snapshot.
38. A plan subscription is a user declaration. It never becomes a Cost record,
    never enters workbench cost metrics or trends, and is never allocated to an
    observation, model, session, or day.
39. Window plan cost is derived at read time from exactly one plan price. It
    keeps its native amount and currency, and stays unavailable when the
    comparison conversion is missing or stale rather than falling back to the
    native number.
40. Plan value ratio divides API retail equivalent by window plan cost for one
    billing domain; the two purposes are never added. Partial pricing coverage
    makes the ratio an explicit lower bound. An unavailable retail equivalent
    leaves the ratio unavailable and never zero.
41. Only billing domains with a declared plan price enter the plan value map.
    Metered billing domains keep their own actual cost, are separately
    identified, and never receive a plan value ratio.
42. A billing period is derived from one declared renewal date and the plan's own
    period length, with month-end renewals clamped into shorter months. Without a
    renewal date the period is unknown, never assumed to align with the selected
    window or the calendar month.
43. Billing-period evidence is collected over each subscription's own period and
    is independent of the selected window. Its elapsed and total days stay
    visible with the result, because a period that has barely started is not a
    poor result and cannot be compared with one that is nearly over.
