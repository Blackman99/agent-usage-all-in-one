# Agent Usage V1 Specification

**Status:** complete

## Problem Statement

个人开发者同时使用 Codex、Claude Code、OpenCode Go 和 Grok 时，必须在多套
客户端、订阅页面和账单控制台之间切换，才能判断当前额度、下次刷新时间、token
消耗和费用。各 provider 的计量窗口、认证方式与可得字段并不一致：有的提供
5 小时和周额度，有的按月或按量计费，有的只能从官方客户端或本地 telemetry
得到部分信息。

用户需要一个可信的一站式视图，在十秒内回答“哪个 agent 快没额度、什么时候
刷新、现在适合使用哪个”，并能够查看 24 小时、7 天和 30 天的 token 与费用
趋势。该工具不能把估算伪装成账单、把未知费用显示成零、通过私有接口窃取
OAuth 凭据，或因为一个 connector 失败而使整个视图失效。

## Solution

构建一个 macOS 优先、开源、本地优先的 Agent Usage 应用。用户运行一个命令后，
本地 daemon 自动启动并打开 Web Dashboard；同一个命令行程序也能输出核心状态、
触发刷新、诊断连接和导出数据。

Dashboard 顶部提供跨 provider 总览、最紧张 quota bucket、最近 reset 和带理由的
recommendation；下方展示 Codex、Claude Code、OpenCode Go、Grok 四张 provider
卡片。每张卡动态渲染 provider 原生 quota bucket，并分别显示额度与刷新、token、
实际费用和历史趋势的 coverage。Grok 卡片内部分离 Grok Build/SuperGrok 与 xAI
API 两个 billing domain，任何数据都不跨域合并。

Connector 以只读方式从官方账户 API、官方客户端、官方 telemetry 或本地 observation
采集数据。所有值携带 data authority、采集时间和 freshness；不可用字段进入明确的
degraded state。Collector 在打开应用时刷新，并可按五分钟周期或可选开机启动持续
积累本地历史。凭据保留在系统 Keychain 或原官方客户端中，产品默认零遥测且不使用
自建云服务。

## User Stories

1. As an individual developer, I want one command to open my usage dashboard, so that I do not visit four separate products.
2. As an individual developer, I want the command to start the local daemon when needed, so that setup remains effortless.
3. As a terminal user, I want a concise status command, so that I can check capacity without opening a browser.
4. As a developer, I want installed agents to be discovered automatically, so that onboarding begins with what already exists on my Mac.
5. As a developer, I want each discovered connector to explain the access it needs, so that I can make an informed authorization decision.
6. As a privacy-conscious user, I want to skip any connector, so that one integration never blocks the rest of the product.
7. As a Codex user, I want to see my provider-native short-window quota, so that I know whether I can continue a session.
8. As a Codex user, I want to see my weekly quota and reset time, so that I can plan larger tasks.
9. As a Codex user, I want account token history when the official client exposes it, so that I can understand recent activity.
10. As a Claude Code user, I want all quota buckets shown with their actual labels, so that All models, Sonnet-only, Fable, or future buckets remain understandable.
11. As a Claude Code user, I want local telemetry token totals, so that I can inspect input, output, cache-read, and cache-write usage.
12. As a Claude Code user, I want an experimental quota connector to fail visibly and safely, so that a client update never produces false data.
13. As an OpenCode Go user, I want rolling five-hour, weekly, and monthly quota buckets, so that I can avoid unexpected throttling.
14. As an OpenCode Go user, I want the official account quota distinguished from local session history, so that I understand cross-device differences.
15. As an OpenCode Go user, I want local tokens and costs grouped by model, so that I can identify expensive routing choices.
16. As a Grok user, I want Grok Build/SuperGrok usage separated from xAI API usage, so that unrelated billing domains are not added together.
17. As a Grok Build user, I want the shared subscription allowance and reset time when the official client exposes them, so that I can plan agent work.
18. As a Grok Build user, I want local token observations even when subscription quota is unavailable, so that the card remains useful in a degraded state.
19. As an xAI API user, I want official token and USD usage history, so that I can reconcile my API consumption.
20. As an xAI API user, I want prepaid balance and spending-limit information, so that I can avoid an unexpected service interruption or bill.
21. As a user, I want the dashboard to identify the most constrained provider, so that the highest-risk limit is immediately visible.
22. As a user, I want reset times shown both relatively and in local absolute time, so that countdowns are actionable and unambiguous.
23. As a user, I want a recommendation with its reasons, so that I can decide whether to switch agents myself.
24. As a user, I want recommendations never to switch an agent automatically, so that the tool remains observational and safe.
25. As a user, I want provider-native quota labels and units preserved, so that unlike limits are not flattened into a misleading total.
26. As a user, I want each value to show its data authority, so that I can distinguish official account data from estimates.
27. As a user, I want every provider card to show its last successful refresh, so that stale data is obvious.
28. As a user, I want an unavailable provider card to remain visible with a reason and recovery action, so that failure is diagnosable.
29. As a user, I want one connector failure isolated from the others, so that partial service remains available.
30. As a user, I want input, output, cache-read, and cache-write tokens kept separate, so that token behavior is accurately represented.
31. As a user, I want usage grouped by provider, billing domain, model, and day, so that I can find the source of consumption.
32. As a user, I want to switch among 24-hour, 7-day, and 30-day views, so that I can inspect short and medium-term trends.
33. As a user, I want actual billed cost separated from API retail-price estimates, so that estimates never masquerade as charges.
34. As a subscription user, I want fixed subscription cost shown separately, so that it is not artificially allocated across tokens.
35. As a user, I want unknown cost displayed as unknown rather than zero, so that missing provider fields do not understate spend.
36. As a user, I want estimated cost to identify its price snapshot and calculation date, so that I can audit the result.
37. As a user, I want actual charges retained in their native billing currency, so that reconciliation remains exact.
38. As a user, I want cross-provider comparison in my chosen currency, so that relative spend is easy to compare.
39. As a user, I want the exchange-rate timestamp and source exposed, so that converted figures remain auditable.
40. As a user, I want the product to predict whether a quota will last until reset, so that I can act before exhaustion.
41. As a user, I want predictions withheld when history is insufficient, so that low-confidence guesses are not presented as facts.
42. As a user, I want to see my highest-consuming models and days, so that I can investigate usage spikes.
43. As a user, I want the dashboard to refresh immediately when opened, so that the initial view is current.
44. As a user, I want a manual refresh action, so that I can request current data after a heavy session.
45. As a user, I want the collector to respect provider polling limits and back off after errors, so that monitoring does not create rate-limit problems.
46. As a user, I want optional five-minute background collection, so that local history accumulates without constant manual action.
47. As a user, I want to choose whether collection starts at login, so that background behavior remains under my control.
48. As a user, I want optional local low-quota notifications, so that I can react while the dashboard is closed.
49. As a user, I want notifications for predicted exhaustion, reset completion, and prolonged connector failure, so that important state changes reach me.
50. As a user, I want repeated notification events deduplicated, so that five-minute refreshes do not become noisy.
51. As a security-conscious user, I want secrets stored only in macOS Keychain, so that the usage database never contains reusable credentials.
52. As a security-conscious user, I want existing provider credentials referenced in place, so that the product does not make extra secret copies.
53. As a security-conscious user, I want logs and exports redacted, so that support artifacts cannot disclose keys or OAuth tokens.
54. As a user, I want the local web service bound only to loopback and protected from unrelated local callers, so that dashboard APIs are not exposed on my network.
55. As a user, I want raw observations retained for 90 days and daily aggregates retained longer, so that useful trends survive without unlimited fine-grained storage.
56. As a user, I want to delete all local usage data, so that I remain in control of stored history.
57. As a user, I want deletion to offer removal of Keychain entries created by the product, so that uninstall cleanup is complete.
58. As a user, I want a redacted JSON export, so that I can diagnose or migrate data without exposing secrets.
59. As a spreadsheet user, I want CSV exports of usage and costs, so that I can perform independent analysis.
60. As a user, I want exports to let me omit account identifiers, so that I can share them more safely.
61. As a Chinese-speaking user, I want a Simplified Chinese interface, so that primary actions are natural to read.
62. As an English-speaking user, I want an English interface, so that the project remains accessible internationally.
63. As a user, I want provider-owned labels left intact when translated context surrounds them, so that official terminology remains recognizable.
64. As a user, I want connector diagnostics from the CLI, so that missing binaries, permissions, and authentication failures are actionable.
65. As a contributor, I want connector contracts and fixtures, so that new providers can be added without changing domain rules.
66. As a contributor, I want live connector checks to be opt-in, so that CI never requires personal credentials.
67. As a contributor, I want deterministic time and pricing inputs in tests, so that reset, forecast, and cost behavior is reproducible.
68. As a maintainer, I want connector schema changes detected, so that experimental client integrations fail closed.
69. As a maintainer, I want the same application service to power CLI and HTTP behavior, so that two user surfaces do not drift.
70. As a maintainer, I want real or sanitized real-account receipts for each connector release, so that mocks do not become the only evidence of compatibility.

## Implementation Decisions

- The implementation will use TypeScript throughout. The web application will use
  SvelteKit and Svelte, while the local runtime and CLI use Node.js. Source
  development uses pnpm, and the distributed package exposes an `agent-usage`
  executable whose default action ensures the daemon is running and opens the
  dashboard.
- The runtime is one local daemon with three responsibilities: a loopback HTTP
  API and web UI, scheduled collection, and durable storage. CLI commands are
  thin clients of the same application service and may start the daemon when it
  is absent.
- The daemon writes a user-only state record containing its port and a per-run
  authentication secret. Browser startup exchanges a one-time launch token for
  a SameSite HTTP-only session. The server binds only to loopback, validates
  origins for mutations, and never exposes a LAN listening option in V1.
- The primary test seam is a `UsageApplication` facade. It accepts connector,
  clock, price, exchange-rate, notification, secret-store, and repository ports;
  it exposes discovery, refresh, overview, history, settings, export, and
  deletion use cases. Both HTTP handlers and CLI commands delegate to this seam.
- A connector returns normalized provider identity, billing domains, dynamic
  quota buckets, usage observations, cost records, coverage, connector health,
  and recovery actions. Connector results are value objects and never write to
  the database directly.
- Connectors execute independently with bounded concurrency, per-connector
  timeout, minimum polling interval, and exponential backoff. A run records its
  start, finish, outcome, schema version, error classification, and last success.
- Data authority is an ordered domain value: official account, official client,
  local observation, estimate, unavailable. Reconciliation chooses the highest
  authority for an overlapping measure and retains lower-authority evidence for
  diagnostics; overlapping values are never summed.
- Coverage is tracked independently for quota/reset, tokens, actual cost, and
  history. The API and UI expose complete, partial, or unavailable per dimension;
  there is no aggregate completion percentage.
- SQLite in WAL mode is the local store. The schema models provider accounts,
  billing domains, connector runs, quota snapshots, usage observations, cost
  records, daily aggregates, price snapshots, exchange-rate snapshots,
  notification events, settings, and product-owned secret references.
- All time values are stored as UTC instants. Query windows use half-open
  intervals, while display uses the current system timezone and includes both
  relative and absolute reset text.
- Usage observations have stable source identifiers when a provider supplies
  them. Otherwise the collector derives an idempotency key from provider,
  account, billing domain, model, time bucket, token kinds, and source so polling
  cannot double-count a snapshot.
- Raw observations are retained for 90 days. A compaction job creates daily
  aggregates before raw deletion. Daily aggregates remain until the user clears
  them; retention status is visible in settings.
- Actual billed cost, subscription cost, and estimated API-equivalent cost are
  separate cost kinds. Unknown actual cost is nullable and displayed as unknown.
  Estimate calculations reference a versioned price snapshot rather than a
  mutable current price table.
- Native billing amounts are immutable. Cross-provider comparison uses a cached,
  dated reference exchange rate and displays its source and timestamp. If a rate
  is absent or stale beyond the accepted window, native amounts remain visible
  and the converted comparison becomes unavailable rather than silently reusing
  an indefinite rate.
- Recommendation logic is deterministic and explainable. It considers the most
  constrained quota, time to reset, recent burn rate, predicted exhaustion, and
  freshness. Stale or incomplete providers are penalized and the generated
  reasons are returned with the recommendation. It cannot execute an agent
  switch.
- Forecasting uses recent normalized burn rate only when the connector has
  sufficient continuous observations. It reports the history interval and a
  confidence state; insufficient or discontinuous history yields no prediction.
- The Codex connector uses the official app-server account rate-limit and usage
  methods where supported. It negotiates capabilities at runtime and degrades
  individual coverage dimensions when the installed version lacks a method.
- The Claude Code connector has two independent paths: an opt-in local OTLP
  receiver for official telemetry observations, and an explicitly authorized,
  version-probed official-client usage adapter for subscription quota. The
  adapter never extracts or reuses Claude OAuth credentials and fails closed on
  unknown output/schema.
- The OpenCode Go connector uses the account-wide official Go usage endpoint for
  rolling five-hour, weekly, and monthly quota snapshots. Local history comes
  from supported OpenCode CLI/session export surfaces. Derived dollar usage from
  percentage times documented limit is marked estimate, not actual cost.
- The Grok provider contains separate Grok Build/SuperGrok and xAI API billing
  domains. Grok Build observations use opt-in official headless/OTel output, and
  its quota adapter is experimental and capability-probed. xAI API history,
  balance, limits, and invoices use the official Management API with a dedicated
  management key.
- Existing official-client credentials are discovered in place only after user
  consent and are not copied. Product-created secrets use a `SecretStore` port
  backed by macOS Keychain. Secret values are redacted from structured logs,
  errors, diagnostics, database rows, and exports.
- First-run onboarding discovers supported binaries and connection states,
  presents requested access per connector, and allows independent connect, skip,
  retry, and diagnose actions. One failed connector never blocks completion.
- The overview contains a risk summary and provider cards. Provider details show
  billing-domain tabs, dynamic quota buckets, token and cost breakdowns,
  24-hour/7-day/30-day history, coverage, freshness, data authority, and recovery
  actions.
- The collector refreshes when the dashboard opens, on manual request, and by a
  default five-minute schedule while running. Provider-specific minimum intervals
  override the global schedule. Start-at-login is opt-in and implemented through
  a user-scoped macOS launch service managed by the CLI.
- Local notifications are opt-in. Events include threshold crossings at 20% and
  5% remaining, predicted exhaustion before reset, observed reset, and prolonged
  connector failure. Notification state is persisted so repeated polls do not
  repeat an unchanged event.
- The interface is internationalized from the first slice with Simplified Chinese
  and English message catalogs. Provider-owned quota and model labels remain
  unmodified strings.
- Export supports JSON and CSV. Export assembly uses normalized domain records,
  omits secret references, defaults to redacting account identifiers, and records
  the query window and authority metadata.
- Structured logs are local, bounded, and redacted. A doctor command reports
  binary detection, connector capability, authentication category, freshness,
  database health, daemon health, and remediation without printing secrets.
- V1 packages may evolve connector parsers independently, but all connector
  changes must preserve the normalized contract and include fixture-based schema
  validation. Experimental integrations are visibly labeled in the UI and API.
- Architecture decisions with long-lived consequences will be recorded as ADRs
  before their implementation ticket completes. At minimum this includes the
  daemon/application seam, normalized authority model, and connector credential
  boundary.

## Testing Decisions

- Good tests assert externally observable behavior through `UsageApplication`,
  local HTTP, CLI subprocesses, or browser interactions. They do not assert
  private function calls, SQL statement shape, component internals, or exact
  implementation structure.
- The main integration suite constructs `UsageApplication` with a temporary
  SQLite database, deterministic clock, fake secret store, fake notifier, and
  connector contract fixtures. This is the highest reusable seam for discovery,
  refresh, reconciliation, history, forecasting, exports, retention, and failure
  isolation.
- Each connector has contract tests built from sanitized official responses or
  client outputs. Tests cover supported capability versions, missing optional
  fields, malformed schema, authentication failure, rate limiting, timeout,
  unavailable cost, and recovery action generation.
- Codex tests use recorded app-server protocol fixtures and a fake subprocess;
  Claude Code and Grok Build tests use OTLP/client fixtures; OpenCode Go tests use
  official usage and local export fixtures; xAI tests use Management API fixtures.
- Repository integration tests exercise migrations, idempotent snapshot ingestion,
  authority reconciliation, half-open time windows, timezone changes, WAL restart,
  compaction, and deletion using a real temporary SQLite database.
- Cost tests freeze price and exchange-rate snapshots. They verify token-kind
  pricing, actual-versus-estimated separation, currency conversion, missing or
  stale rates, and the invariant that unknown is not zero.
- Forecast and recommendation tests use a deterministic clock and explicit
  observation series. They cover insufficient history, stale data, reset inside
  the forecast horizon, competing quota buckets, and reason text/message keys.
- HTTP tests start the real loopback server and verify launch-token exchange,
  session enforcement, origin checks, refresh semantics, API error isolation,
  and that the server does not bind to a non-loopback interface.
- CLI tests run the packaged executable against a temporary application home and
  daemon. They cover default open behavior, status, refresh, doctor, export,
  start-at-login management, and useful nonzero exit codes.
- Browser tests use Playwright for onboarding, overview, provider detail,
  24-hour/7-day/30-day switching, authority labels, degraded states, language
  switching, manual refresh, notification settings, export, and data clearing.
- Security tests inject recognizable fake secrets and assert they never appear in
  logs, database dumps, API payloads, browser content, doctor output, or exports.
- Notification tests use a fake notifier and persistent event store to verify
  threshold crossings, reset detection, prolonged failures, and deduplication.
- Live connector checks are separate, opt-in commands requiring the user's local
  authenticated clients or keys. They never run in ordinary CI. A release receipt
  records provider/client version, capability coverage, redacted timestamps, and
  pass/fail without storing account identifiers or secret material.
- Continuous verification runs formatting, linting, TypeScript checks, unit and
  integration tests, connector contract tests, production build, packaging smoke
  tests, and browser tests. The full suite runs before final review and commit.
- There is no prior test implementation in this empty repository. The first
  tracer slice establishes these test helpers and becomes the prior art for all
  later tickets.

## Out of Scope

- Windows and Linux packaging or background-service integration.
- Team dashboards, shared accounts, organization rankings, and role-based access.
- Multiple active accounts for the same provider, beyond retaining account ids
  in the domain model for future expansion.
- Automatic agent switching, task routing, prompt forwarding, or model execution.
- Cloud sync, product-owned accounts, hosted dashboards, or product telemetry.
- Project and session drill-down beyond source data needed for connector
  diagnostics and future-compatible storage.
- Cache-efficiency recommendations, savings simulations, anomaly detection,
  custom monthly budgets, and a quota reset calendar.
- Browser scraping, private provider endpoints, cookie extraction, OAuth token
  reuse, or bypassing provider terms and access controls.
- Exact reconstruction of usage that occurred before installation when an
  official provider history API does not supply it.
- Treating API-equivalent retail estimates as subscription value, actual billed
  cost, or proof of provider quota accounting.
- Publishing to npm, Homebrew, or another public registry during V1 implementation;
  the repository will produce locally installable/packageable artifacts and
  document a later release path.

## Further Notes

- Product completeness means truthful coverage across all four providers, not
  identical fields. Each provider must have at least one real end-to-end
  collection path and a verified degraded path.
- OpenCode Go quota is account-wide, while local history may omit other machines;
  the UI must explain that scope difference.
- Claude Code and Grok Build quota adapters are experimental because their public
  third-party contracts are weaker than their official local telemetry surfaces.
  Runtime capability probing and schema validation are release requirements.
- Grok is a provider name in the UI, not a single billing total. Grok
  Build/SuperGrok and xAI API remain independent at storage, API, recommendation,
  and display layers.
- The first implementation should prefer a narrow working path through discovery,
  collection, persistence, API, CLI, and UI before expanding provider coverage.
- The specification is based on the shared understanding confirmed on
  2026-08-28. Provider capabilities and prices are drift-prone and must be
  revalidated during their connector tickets.
