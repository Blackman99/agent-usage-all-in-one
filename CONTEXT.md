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
  It comes from the source-reported total, a legacy total, or the sum of
  categories under the observation's declared Token semantics, in that order.
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
- **Cost record**: An actual billed amount, a fixed subscription cost, or an API
  retail-price estimate. These cost kinds remain separate.
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
