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
