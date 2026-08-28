# Usage-first Dashboard V2 Specification

**Status:** complete

## Problem Statement

Agent Usage 已经能够采集 Codex、Claude Code、OpenCode Go、Grok Build/SuperGrok
和 xAI API 的大部分可得数据，但当前 Dashboard 将 Connections、Monitoring、
Diagnostics 和 Privacy 放在用量之前。用户打开“用量中心”时，首先看到的是管理界面，
而不是最关心的额度、reset、Token 和费用。

Provider 配置与 Provider 用量又被实现成两套独立面板。未连接、连接失败、数据降级和
正常用量分别出现在不同区域，用户必须在页面中来回寻找状态和恢复动作。Grok 还包含
Grok Build/SuperGrok 与 xAI API 两个独立 billing domain，因此不能通过简单匹配
Provider id 与 Connector id 来合并界面。

现有 Token 与费用分析也不足以支撑可信的全局总览。历史数据能够按模型聚合 Token，
费用只能在 billing domain 层汇总，二者没有可靠关联；系统没有统一、版本化的官方
API 零售价目录，也不能计算模型级 API 等价零售价。各 Provider 的 Token 粒度和时间
精度不同，部分来源只有 `all-models` 总量、日级聚合或账单创建时间。若只重排 UI，
将会产生看似完整但无法守恒、无法审计的金额和模型排行。

用户需要一个用量优先、紧凑、可信的 Dashboard：在打开页面后立即看见各 Provider
的原生额度和 reset，再看见选定时间范围内的已记录 Token、不同语义的金额、趋势和
模型排行；连接配置和恢复动作应直接出现在对应 Provider 卡片中。任何缺失、估算、
粗粒度时间或无法定价的数据都必须显式标注，不能显示为零或伪装成完整数据。

## Solution

将 Dashboard 重构为用量优先的信息架构。页头下方首先显示一条紧凑全局摘要，包含
选定时间范围内的已记录 Token、API 等价零售价、最紧张 quota bucket 和数据更新时间。
随后以响应式网格展示四张 Provider 卡，每张卡直接组合原生 quota bucket、reset、
当前窗口 Token/等价金额、freshness、connection target 和 recovery action。正常连接
只保留低干扰状态与管理入口；未连接时，用量位置自动变成就地连接流程。

Grok 仍是一张顶级 Provider 卡，内部以明确的 billing-domain tabs 分隔
Grok Build/SuperGrok 和 xAI API。两个 domain 的 quota、Token、费用、余额和历史永不
合计。Connector 与 Provider/billing domain 的关系通过显式 connection target 映射
表达，不依赖字符串 id 相等。

Provider 卡之后提供全局 Token 与金额工作台。默认窗口为 7 天，并记住用户最后选择；
用户可以切换 24 小时、7 天和 30 天。工作台展示已记录 Token、实际费用、来源估算和
API 等价零售价，并分别给出 authority、时间精度、分类覆盖率和定价覆盖率。趋势图可以
在 Token 与 API 等价零售价之间切换，按 Provider 堆叠；模型排行默认按 Token 排序，
可切换为按 API 等价零售价排序。点击模型后打开右侧详情，展示 Token 分类、金额分解、
官方价格版本、数据来源和趋势。

扩展 normalized domain contract，使每条 Usage observation 能表达 Provider 原生总量、
非重叠 Token 分类、模型归属和时间精度。扩展 Cost record，使实际费用、固定订阅费、
来源估算与 API 等价零售价保持独立，并允许金额关联模型、usage observation 与版本化
price snapshot。内置只读的官方 API 价格目录；历史回算选择 observation 时间点生效的
价格版本，不能可靠识别模型、Token 类型或价格档位的数据保持未知。

Monitoring、完整 Diagnostics、Privacy、导出和清理进入顶部设置抽屉。Provider 异常时
才显示紧凑风险提示，并可以直接定位到对应卡片或设置项。整个体验使用官方 Provider
Logo、中性紧凑的系统深浅色视觉、可访问的键盘交互和响应式布局。

## User Stories

1. As an individual developer, I want usage to be the first content on the dashboard, so that configuration does not obscure the product's purpose.
2. As an individual developer, I want a compact global summary, so that I can understand recent usage in a few seconds.
3. As an individual developer, I want to see recorded Token volume in the summary, so that I know how much agent activity was observed.
4. As an individual developer, I want to see API retail equivalent value in the summary, so that I can understand the retail value of subscription usage.
5. As an individual developer, I want to see the most constrained native quota bucket, so that I know which Provider needs attention.
6. As an individual developer, I want the summary to show when its data was generated and observed, so that stale numbers are obvious.
7. As a Provider user, I want each Provider card to show connection state and usage together, so that I do not search a separate configuration section.
8. As a Provider user, I want an unconnected card to offer connection in the usage area, so that setup is contextual.
9. As a Provider user, I want a connected card to reduce configuration to a quiet management control, so that quota remains visually primary.
10. As a Provider user, I want a connection action to refresh connection, usage, and diagnostics together, so that stale errors do not remain after recovery.
11. As a Provider user, I want only the affected card to show a loading state during configuration, so that the rest of the dashboard remains usable.
12. As a Provider user, I want native quota bucket labels preserved, so that unlike limits are not flattened into generic columns.
13. As a Provider user, I want every quota bucket to show percentage used and reset time, so that the limit is actionable.
14. As a Provider user, I want reset time shown as both a countdown and local absolute time, so that I can plan accurately.
15. As a Provider user, I want each card to show freshness and authority, so that I understand the quality of the displayed value.
16. As a Provider user, I want the card to show Token and API retail equivalent for the selected time window, so that quota and consumption remain connected.
17. As a Provider user, I want detailed Token categories hidden until requested, so that the four-card overview stays compact.
18. As a Provider user, I want a degraded card to remain visible with an exact recovery action, so that one failure is diagnosable.
19. As a user, I want risk guidance to appear only when it is actionable, so that a permanent recommendation panel does not consume the first screen.
20. As a Grok user, I want one recognizable Grok Provider card, so that related products retain their product identity.
21. As a Grok Build user, I want the Build/SuperGrok billing domain to preserve its shared subscription quota, so that no fictional five-hour bucket is introduced.
22. As an xAI API user, I want API usage, actual cost, balance, and limits in a separate billing-domain tab, so that they are not confused with SuperGrok.
23. As a Grok user, I want Build/SuperGrok and xAI API totals never to be merged, so that independent billing domains remain truthful.
24. As a user, I want the default history window to be 7 days, so that trends and model rankings are meaningful on first open.
25. As a returning user, I want my most recent 24-hour, 7-day, or 30-day choice remembered locally, so that the dashboard respects my workflow.
26. As a user, I want the selected window to control Token, actual cost, source estimate, retail equivalent, trends, and rankings together, so that panels remain comparable.
27. As a user, I want Provider-native quota windows to remain unchanged when I switch analysis time, so that quota semantics are not rewritten.
28. As a user, I want a normalized recorded-Token total, so that every observed Token is counted at most once.
29. As a user, I want source-reported totals preserved when detailed Token categories are unavailable, so that coarse official data is not discarded.
30. As a user, I want unclassified Token shown separately, so that `all-models` data does not masquerade as a real model.
31. As a user, I want input, output, reasoning, cache-read, and cache-write values retained, so that model behavior is inspectable.
32. As a user, I want reasoning Token semantics normalized per Provider, so that reasoning is not accidentally double-counted as output.
33. As a user, I want actual billed cost shown separately, so that it can be reconciled with an account bill.
34. As a user, I want Provider- or client-reported estimates shown separately, so that upstream estimates are not presented as actual charges.
35. As a subscription user, I want API retail equivalent shown separately, so that I can compare retail value without pretending it is a bill.
36. As a subscription user, I want fixed subscription cost kept separate from Token analytics, so that a monthly fee is not arbitrarily allocated across usage.
37. As a user, I want unknown cost displayed as unavailable rather than zero, so that incomplete data does not understate value.
38. As a user, I want every retail-equivalent amount linked to an official price version, so that the calculation is auditable.
39. As a user, I want historical retail equivalent calculated with the price effective at observation time, so that later price changes do not rewrite history.
40. As a user, I want unrecognized models and ambiguous context tiers excluded from retail estimation, so that the application does not guess.
41. As a user, I want pricing coverage shown beside an estimated total, so that I know how much recorded usage contributed to it.
42. As a user, I want Token classification coverage shown separately, so that coarse observations are not mistaken for detailed telemetry.
43. As a user, I want amounts retained in USD and optionally converted to CNY, so that official prices remain exact while local comparison is convenient.
44. As a user, I want CNY as the default display and USD as a secondary value, so that the dashboard fits my locale without hiding the source currency.
45. As a user, I want stale or missing exchange rates to disable only CNY conversion, so that USD evidence remains visible.
46. As a user, I want a Token trend that can switch to retail equivalent, so that volume and value can be compared in the same visual frame.
47. As a user, I want 24-hour trends grouped by hour and 7-day/30-day trends grouped by day, so that chart resolution matches the selected window.
48. As a user, I want trend series stacked by Provider, so that I can see which product drove a change without overwhelming the chart with models.
49. As a user, I want missing observation intervals rendered as gaps, so that absent collection is not reported as zero usage.
50. As a user, I want coarse daily or billing-period data visibly distinguished from event-time data, so that rolling windows do not imply false precision.
51. As a user, I want a Top 5 model ranking ordered by Token by default, so that the largest observed consumers are immediately visible.
52. As a user, I want to sort the model ranking by API retail equivalent, so that I can identify the models with the greatest retail value.
53. As a user, I want identical model names kept separate by Provider and billing domain, so that unlike authorities and prices are not merged.
54. As a user, I want unclassified usage below the model ranking, so that it contributes to totals without displacing known models.
55. As a user, I want a model-detail drawer with Token categories, price line items, authority, observation time, and trend, so that I can audit a ranking entry.
56. As a user, I want actual cost, source estimate, and API retail equivalent shown as three distinct metrics, so that no composite “spend” number mixes meanings.
57. As a user, I want Monitoring, Diagnostics, Privacy, export, and clear controls in a settings drawer, so that administration remains available without dominating usage.
58. As a user, I want an error banner to deep-link to the affected Provider or diagnostic, so that recovery takes one action.
59. As a user, I want official OpenAI, Claude, OpenCode, and Grok artwork, so that Provider identity is recognizable and professional.
60. As a user, I want a text-only fallback when an official Logo is unavailable, so that the application never invents a letter avatar or imitation mark.
61. As a user, I want the dashboard to follow system light and dark appearance, so that it integrates with my desktop environment.
62. As a keyboard user, I want cards, tabs, drawers, filters, and charts to be operable without a pointer, so that all primary workflows are accessible.
63. As a user with reduced-motion preferences, I want nonessential transitions disabled, so that the dashboard remains comfortable.
64. As a narrow-window user, I want cards and analytics to collapse to one column without horizontal scrolling, so that the local dashboard remains usable.
65. As a Chinese-speaking user, I want all new interface copy in Simplified Chinese, so that the redesigned dashboard remains complete in my preferred language.
66. As an English-speaking user, I want an equivalent English catalog, so that language switching never reveals missing strings.
67. As a privacy-conscious user, I want official Logo assets bundled locally, so that rendering the dashboard does not contact third-party image hosts.
68. As a privacy-conscious user, I want all existing credential boundaries preserved, so that merging configuration into cards does not expose secrets.
69. As a maintainer, I want model pricing to be versioned and deterministic in tests, so that historical calculations are reproducible.
70. As a maintainer, I want derived retail estimates to be idempotent and rebuildable, so that migrations and repeated refreshes cannot duplicate money.
71. As a maintainer, I want Connector-to-Provider mapping to be explicit, so that Grok's two connection targets do not depend on coincidental identifiers.
72. As a maintainer, I want existing CLI status, doctor, export, retention, and deletion behavior preserved, so that a dashboard redesign does not regress nonvisual workflows.
73. As a maintainer, I want official branding and pricing evidence recorded in the repository, so that future updates can be reviewed against authoritative sources.
74. As a maintainer, I want the complete redesign verified against sanitized fixtures and opt-in live receipts, so that attractive UI does not conceal unsupported data.

## Implementation Decisions

- The existing local daemon and `UsageApplication` remain the primary use-case and test seam. The browser, CLI, collector, connectors, and repository continue to delegate through that boundary; the Dashboard does not query SQLite or Provider clients directly.
- The existing `overview` use case is expanded into the Dashboard read model rather than introducing several page-specific endpoints. It includes global Token/money analysis, trend buckets, model ranking, coverage evidence, Provider cards, and explicit connection targets. Settings and detailed doctor output remain separate use cases.
- A connection target explicitly references its Provider and optional billing domain. The Dashboard never assumes Connector id equals Provider id. Grok maps its official-client Connector to the Build/SuperGrok billing domain and its managed API Connector to the xAI API billing domain.
- After connect, skip, retry, or managed-secret replacement, the application refreshes connection status, affected usage, and diagnostics before returning the updated card state. The operation remains scoped so other Provider cards stay interactive.
- The Provider card is the shared presentation boundary for normal, unconnected, loading, degraded, and stale states. It renders dynamic quota buckets, not fixed five-hour/week columns.
- Grok remains one top-level Provider with independent Build/SuperGrok and xAI API tabs. No global or Provider total may add values across those two billing domains; global analysis treats each domain as a separately identified contribution.
- Normalized Token data distinguishes a source-reported total from categorized Token fields. Each Connector declares whether reasoning is included within output and how cache fields relate to input, allowing the normalizer to produce a non-overlapping recorded total without discarding the original values.
- Observations with only a total, an unknown model, or a synthetic `all-models` label contribute to recorded Token totals as unclassified usage. They do not enter the known-model ranking and do not receive retail estimates unless the required model and token-kind evidence is present.
- OpenCode Go normalization is corrected so reasoning is not silently merged into output while also contributing to total. Other Connector contracts are audited for the same single-count invariant.
- Usage observations carry time precision separately from the observation instant. Supported precision distinguishes event/hour data, day aggregates, and billing-period or invoice-derived data. Query results expose missing intervals and precision coverage; the UI never fills an unobserved interval with zero.
- Rolling query windows remain UTC half-open intervals. Timezone affects labels, not membership. Coarse observations may contribute to appropriately labelled day or billing-period summaries, but they cannot be presented as exact hourly activity.
- Cost semantics expand to four non-overlapping purposes: actual billed cost, fixed subscription cost, Provider/client-reported estimate, and calculated API retail equivalent. Existing generic estimate records migrate through an expand-contract transition so the application remains readable during schema evolution.
- The Token workbench displays actual billed cost, reported estimate, and API retail equivalent as separate headline metrics. Fixed subscription cost remains available in billing details and exports but is never allocated across Token or combined with retail equivalent.
- Cost records can optionally reference a model and source usage observation. Retail-equivalent records contain auditable line items for priced Token kinds, a price snapshot, source currency, and calculation time. Missing amounts remain nullable.
- A bundled, read-only official price catalog is versioned by Provider, billing domain, canonical model, model aliases, currency, effective interval, context tier, and per-million Token-kind rates. Runtime rendering and calculation do not scrape vendor websites.
- Model alias resolution is scoped by Provider and billing domain. A matching model without a determinable context or pricing tier remains unpriced rather than using an average, cheapest, or most common price.
- Historical backfill derives retail-equivalent records from retained observations using the price version effective at each observation time. It is idempotent and rebuildable, never mutates actual charges or source-reported estimates, and leaves ineligible history unknown.
- Classification coverage and pricing coverage are metric-specific ratios for the selected window. They supplement, but never replace or compress, independent domain Coverage states for quota, Token, actual cost, and history.
- Overlapping quota-window dollar equivalents, such as simultaneous short, weekly, and monthly allowance views, remain quota context and are not summed into time-range cost totals.
- Native monetary values and USD official price calculations are retained exactly. CNY comparison uses a timestamped exchange-rate snapshot. Missing or stale exchange rates make only the converted value unavailable.
- The initial Dashboard window is 7 days. A local, non-sensitive preference remembers the latest 24-hour, 7-day, or 30-day selection and display currency; it does not enter exports or Provider records.
- The compact summary contains recorded Token, API retail equivalent with pricing coverage, the most constrained quota bucket, and latest data time. Actual and reported amounts remain in the Token workbench instead of expanding the summary.
- Provider cards use a responsive grid with a practical minimum width: two columns in normal desktop windows, up to four when space supports full quota labels, and one column on narrow screens.
- Quota is visualized using horizontal progress bars with percentage, status color, countdown, local reset time, authority, and observation time. Decorative gauges and invented gradients are excluded.
- Token analytics contains three amount metrics, one Provider-stacked trend with Token/retail toggle, a Top 5 known-model ranking with Token/retail sort, an unclassified section, and a right-side model-detail drawer.
- The model-detail drawer shows Provider and billing domain, all available Token categories, retail calculation line items, price source/version/effective time, authority, time precision, observation time, pricing coverage, and the selected-window trend. It does not contain general model marketing content.
- Risk guidance is conditional. Healthy normal state does not reserve a large recommendation section; actionable low quota, stale data, or connection failures produce one compact banner linked to the relevant card or settings diagnostic.
- Monitoring, full diagnostics, privacy, export, retention, clear-data, and connection administration are grouped in a keyboard-accessible settings drawer. Provider-card recovery actions may open the drawer at a focused target.
- UI request failures are isolated by data concern. Settings or retention failures cannot replace a successfully loaded usage overview with a global error state.
- Tokens use compact notation in overview surfaces and exact integers in accessible labels and details. Monetary values below one cent retain enough significant digits to avoid rendering a positive value as zero.
- The UI follows system light/dark preference, uses neutral surfaces, preserves visible focus, supports reduced motion, and avoids large decorative gradients, excessive shadows, or Provider-colored card backgrounds.
- Provider identity uses bundled official assets without modification: OpenAI Blossom for Codex, the official Claude icon for Claude Code, official OpenCode light/dark artwork for OpenCode Go, and the official Grok mark for both Grok billing domains. Product text differentiates billing domains. If an official asset cannot be obtained and reviewed, the fallback is plain product text.
- Official Logo files preserve aspect ratio, original color variants, trademark guidance, and local bundling. The artwork identifies external Providers only and is never used as Agent Usage's own product mark or as an endorsement claim.
- The existing first-letter circle avatar is removed. Third-party Logo aggregators, traced approximations, recolored marks, and remote runtime image loads are prohibited.
- New domain terms and invariants for reported estimate, API retail equivalent, Token total semantics, time precision, classification coverage, and pricing coverage are added to the domain context. A durable ADR records the versioned price catalog, historical derivation, and expand-contract cost migration before implementation completes.
- Existing CLI status, doctor, export, deletion, retention, daemon authentication, Connector consent, credential ownership, redaction, and background collection contracts remain compatible. Exports gain the new model, time-precision, amount-purpose, and price evidence fields without exposing secrets.

## Testing Decisions

- Good tests assert observable behavior through the `UsageApplication` read model, the authenticated local HTTP API, packaged CLI commands, or browser interactions. They do not assert SQL text, private component state, CSS class names, or internal helper calls.
- The primary integration seam is `UsageApplication` with a real temporary SQLite repository, deterministic clock, fixed official price catalog, fixed exchange rates, fake Connector snapshots, and explicit connection targets. This one seam verifies normalization, derivation, aggregation, connection refresh, and failure isolation.
- Repository migration tests start from the current schema and prove expand-contract compatibility, idempotent backfill, restart safety, no duplicate derived cost, price-effective historical selection, and preservation of actual/subscription/source-estimate records.
- Token contract tests cover source-reported totals, complete category breakdowns, reasoning included-in-output versus separate reasoning, cache semantics, unknown models, `all-models`, and the invariant that every recorded Token is counted at most once.
- Price tests use deterministic official catalog fixtures. They cover model aliases, Provider/domain scoping, context tiers, input/output/reasoning/cache prices, effective-date boundaries, unknown models, ambiguous tiers, partial pricing coverage, and sub-cent values.
- Cost tests prove actual, subscription, reported estimate, and retail equivalent never merge; overlapping quota-window equivalents never enter history totals; model and line-item amounts reconcile exactly to each eligible retail total.
- Window tests cover UTC half-open boundaries, persisted 7-day default, local timezone labels, hour/day bucket selection, gaps rather than zeroes, coarse time precision, and different results for 24-hour, 7-day, and 30-day ranges.
- Dashboard API tests verify one read model contains global summary, Provider cards, explicit connection targets, model ranking, trend, money categories, coverage ratios, authority, observation time, and independent Grok billing domains.
- Connection integration tests prove unconnected, connecting, connected, skipped, degraded, and recovered Provider-card states. A successful action must refresh connection, usage, and diagnostic evidence before completion while leaving unrelated Providers available.
- Browser tests cover the information order from summary to Provider cards to Token workbench, conditional risk banner, inline connection, Grok tabs, time/currency persistence, trend toggles, ranking sort, unclassified usage, model detail, and settings deep links.
- Accessibility browser checks cover keyboard-only navigation, focus return when drawers close, tab semantics, progress-bar accessible values, chart text alternatives, visible focus, reduced motion, and no horizontal scrolling at the narrow supported width.
- Theme and responsive verification runs representative desktop/narrow widths in light and dark appearance. Visual review verifies official Logo variants, neutral card surfaces, compact number formatting, sub-cent amounts, missing-data gaps, and absence of first-letter avatars.
- i18n tests require identical Simplified Chinese and English key sets and verify all new summaries, money categories, coverage labels, recovery states, settings controls, chart alternatives, and pricing evidence in both languages.
- Security and privacy tests prove locally bundled artwork causes no external image request, connection controls never expose credentials, exports remain redacted, and settings/data-clear scopes remain unchanged.
- Connector tests continue using sanitized official fixtures. Opt-in live receipts verify the supported Connector data still maps into the new Token and time-precision contract; unsupported dimensions remain explicitly unavailable.
- Full completion requires formatting, lint, typecheck, unit/integration/contract tests, production build, packaged install smoke, browser tests, and an interactive visual review with real local data for all available Providers.

## Out of Scope

- Automatically switching, launching, or routing work to an agent based on quota.
- Team accounts, shared dashboards, multi-user authentication, cloud synchronization, or a hosted telemetry service.
- Adding Providers beyond Codex, Claude Code, OpenCode Go, Grok Build/SuperGrok, and xAI API.
- Combining Grok Build/SuperGrok and xAI API quota, Token, cost, balance, or history.
- Allocating fixed subscription fees across Token, sessions, models, or days.
- Guessing a model, Token type, context tier, price, exchange rate, or missing observation.
- Scraping live vendor pricing pages at application runtime or accepting unreviewed crowd-sourced pricing.
- Editing prices through the Dashboard in this release.
- Replacing Provider credentials, bypassing official Connector consent, or reading private Provider endpoints.
- A native mobile application, mobile-first layout, or push notifications outside existing local notifications.
- Model quality benchmarking, model descriptions, prompt inspection, session-content analysis, or automatic optimization recommendations.
- Designing a new Agent Usage product Logo; this effort only replaces Provider identity artwork with official Provider assets.

## Further Notes

- Official branding evidence should be retained with the vendored assets. Current authoritative sources are the OpenAI brand resources, Anthropic Press Kit, OpenCode brand resources, and xAI brand guidelines/official Grok asset package.
- OpenAI Blossom is used to identify Codex's Provider because there is no separately confirmed official Codex small-card mark. It must not become the Agent Usage application Logo.
- The official Grok asset package may reject automated download in some environments. This is not permission to trace or recreate it; implementation must obtain and review the official artifact or use the text-only fallback.
- Historical pricing is only as complete as model and Token-kind evidence. The Dashboard should make increasing pricing coverage visible over time without rewriting unknown history as zero.
- The existing completed V1 specification and tickets remain historical records. This effort is a new V2 redesign and must not reopen or modify those completed tracker files.
