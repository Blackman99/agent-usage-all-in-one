# Agent Usage Domain Context

## Product boundary

Agent Usage is a local-first, open-source usage center for individual
developers. The macOS-first product launches a local web dashboard from one
command and exposes the same core summary through a CLI. It never switches an
agent automatically and does not upload private usage data or telemetry to a
product-owned service.

The initial providers are Codex, Claude Code, OpenCode Go, and Grok. Grok is one
top-level provider with two independent billing domains: Grok Build/SuperGrok
subscriptions and the xAI API. Their usage and costs must never be merged.

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
- **Trend gap**: An hourly or daily interval with no Token observation. It stays
  visibly discontinuous; cost evidence does not fabricate a Token observation.
- **Data authority**: The provenance level of a value: official account,
  official client, local observation, estimate, or unavailable.
- **Freshness**: The age and last-success state of a connector result.
- **Coverage**: The independent availability state for quota/reset, tokens,
  actual cost, and history. Coverage is never compressed into one score.
- **Recommendation**: A transparent, reasoned suggestion about which agent has
  healthier capacity. Recommendations never perform an automatic switch.
- **Collector**: The optional local background process that refreshes connectors
  and persists observations for 24-hour, 7-day, and 30-day views.
- **Degraded state**: A truthful partial result that retains the provider card,
  explains the missing field, and offers a recovery action.

## Invariants

1. Source priority is official account, then official client, then local
   observation, then estimate.
2. Values from overlapping sources are reconciled, not added together.
3. Unknown cost is never represented as zero.
4. Provider-native quota labels and windows are preserved.
5. One connector failure cannot make other providers unavailable.
6. Credentials stay in the system keychain or their owning official client and
   never appear in logs, exports, or the usage database.
7. Every displayed number carries its data authority and observation time.
8. Each observation contributes exactly one recorded Token total. Category
   fields and source totals are evidence for that total, never additive totals.
9. Recorded Tokens equal classified plus unclassified Tokens; a source total
   larger than its categorized fields leaves an explicit unclassified remainder.
10. `all-models` and unknown-model observations contribute to overall and time
    summaries but never to per-model rankings.
11. Migration preserves observation identity, authority, and observed time and
    does not invent source totals, model attribution, or time precision.
12. Account-wide and this-Mac observations retain their scope through history,
    CLI output, and export; unlike scopes are never presented as interchangeable.
13. Cumulative telemetry is rejected before persistence unless a Connector has
    an explicit non-overlapping reconciliation algorithm; it is never summed as
    though it were delta data.
14. Production Connectors never write the legacy Token-total input. The SQLite
    compatibility column and `legacy-total` derivation remain read-only migration
    evidence so a V1 database can upgrade without losing or duplicating usage.
15. Retail-equivalent records are derived only from a known Provider, billing
    domain, model, non-overlapping Token kinds, context tier, and price effective
    at the observation time. Missing or ambiguous evidence remains unpriced.
16. Repeating collection, restart, or price derivation for the same observation
    and price version is idempotent. Line items reconcile exactly to the stored
    retail amount and never mutate actual, subscription, or reported estimates.
17. Unknown retail equivalent is unavailable, never zero. Pricing coverage may
    be zero when Tokens were observed but none were eligible for pricing.
18. Context-sensitive pricing requires observation evidence at the same
    granularity as the Provider rule. Day or billing-period aggregates cannot
    select request-length or time-of-day tiers. Grok Build/SuperGrok and xAI API
    aliases, amounts, and coverage remain isolated by billing domain.
19. Retained observations may be backfilled with the catalog entry effective at
    their observation time. Once recorded, a retail price snapshot is immutable;
    a later catalog release adds a new version instead of rewriting history.
20. Actual, subscription, reported-estimate, and retail-equivalent are mutually
    exclusive cost purposes. No aggregate combines unlike purposes.
21. OpenCode Go allowance values belong to quota context. Five-hour, weekly, and
    monthly overlapping allowance values never become time-range cost records.
22. Fixed subscription cost is billing-domain evidence only. It is never
    allocated to a Token observation, model, session, or daily bucket.
23. Workbench cost metrics include only actual, reported-estimate, or
    retail-equivalent records. Subscription and legacy-unknown evidence never
    enter those metrics or their trends.
24. A converted workbench amount is available only when every contributing
    record has a known native amount and valid conversion. Missing or stale CNY
    evidence cannot hide the original USD or other native amount.
25. Workbench trend segments retain Provider and billing-domain identity. An
    interval without observations remains a gap, and day or billing-period
    precision remains explicit in visual and accessible output.
