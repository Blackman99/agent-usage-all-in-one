# agent-usage-all-in-one

## 0.6.1

### Patch Changes

- 9bb16a3: Separate Grok token statistics between official SpaceXAI models and custom endpoints.
  Previously, all Grok session transcript activity was attributed to the `grok-build-subscription` domain ("Grok Build / SuperGrok shared pool"), polluting the subscription quota pool with tokens from custom model endpoints (such as Gemini, Kimi, local models, or proxy endpoints configured in `~/.grok/config.toml`).
  Now:

  - Official Grok models (`grok-4.6`, `grok-4.5`, `grok-build-0.1`, `grok-code-fast-1`, etc.) remain in `grok-build-subscription` with the official weekly subscription allowance.
  - Custom endpoint models are attributed to a separate `custom` (Custom endpoints) billing domain (or the custom route if configured in `config.toml`).
  - Custom endpoint domains are included in workbench and global headline totals with full token and retail-equivalent share tracking, matching the multi-domain design of `dsh`.

## 0.6.0

### Minor Changes

- 19d4a5b: Add official retail pricing for Anthropic Claude Fable 5.1 (`claude-fable-5-1`).
  Anthropic launched Fable 5.1 on September 1, 2026. The pricing catalog reflects its official rates:

  - Base input: $10 / MTok
  - Output: $50 / MTok
  - Cache read: $0.25 / MTok (75% reduction compared to Fable 5's $1.00 / MTok)
  - 5-minute cache write: $12.50 / MTok (1.25x base input)
  - 1-hour cache write: $20.00 / MTok (2x base input)

  Aliases include `Claude Fable 5.1`, `claude-fable-5.1`, `fable-5.1`, `fable-5-1`, and date-pinned variants. Observations from 2026-09-01 onwards are automatically priced with these rates.

- 81d3c5b: Support user-configured custom model rates for custom endpoints and routes.
  When using custom routes, proxy endpoints, or third-party models in dsh (DeepSeek
  Harness) or other providers, session tokens are recorded locally but previously
  remained unpriced because the built-in retail catalog only covers known official
  models under fixed billing domains.

  Developers can now configure per-model input, output, and cache-read rates per
  million tokens (in USD) either wildcarded across all routes or qualified by
  billing domain. Custom rates take precedence over default catalog entries, and
  saving, updating, or deleting custom rates automatically triggers background
  re-pricing to backfill previously unpriced historical sessions. Rates can be
  managed via the Settings drawer in the dashboard, the HTTP API (`/api/custom-rates`),
  or the CLI (`agent-usage rates list / set / delete`).

- 19d4a5b: Support full CRUD lifecycle and enhanced UX workflows for custom model rates.
  Developers can now:

  - View all configured custom model rates in the Settings drawer with auto-refresh on drawer open, an active rate count badge in the settings navigation bar, and a manual refresh button.
  - Edit existing rates inline directly within the custom rate card view and update rates via `PUT /api/custom-rates/:id` or CLI `agent-usage rates set <model> --id <id>`.
  - Retrieve individual custom model rate details via `GET /api/custom-rates/:id` and CLI `agent-usage rates get <id>`.
  - Select target providers easily with a preset dropdown (Grok, DeepSeek dsh, Claude Code, Codex, OpenCode Go, OpenCode, Antigravity, or custom provider ID).
  - One-click launch rate configuration directly from unpriced model detail panels in the Token & Model Costs view.

### Patch Changes

- 19d4a5b: Include all dsh (DeepSeek Harness) provider routes in workbench and global headline totals.
  Previously, dsh selected only its default `deepseek-official` route as `includedInHeadline: true`, causing custom endpoint routes (e.g. proxy providers, local models) to be treated as separate non-headline domains with `不适用于摘要占比` ("Not applicable to headline") in model rankings. Because all dsh routes represent primary session activity without subscription double-counting, every active dsh route is now included in headline totals, enabling token and retail equivalent shares to be accurately calculated and displayed in the breakdown table.
- 186d8f6: Stop showing an Antigravity quota percentage that no source reports. The two
  `5 hour` and `Week` windows without a model group were computed by dividing local
  Token counts by a built-in guess at Antigravity's allowance — 61% used meant
  60,696,074 Tokens against an assumed 100,000,000, a limit Google does not publish
  — and an empty window reset to "five hours from now" on every collection. Only the
  official client states either allowance, so quota now comes solely from its live
  language server and is reported as unavailable when that is unreachable, while
  Tokens, history, and equivalent cost stay exact.

  A quota window a Provider has stopped reporting is now retired instead of staying
  on the card beside the windows that replaced it, which is what left the derived
  rows sitting under the real ones. Existing databases have those derived rows
  removed on open.

- 186d8f6: Keep the local service running and the dashboard usable on a large local history.
  The overview response carried every retained usage observation and cost record, so
  a 30-day window over months of usage grew past what JSON can encode: the encoder
  threw after the response had already started, the second write ended the daemon,
  and every dashboard request failed with a connection reset. Model details now
  receive the aggregates they display — Token composition, price snapshots, and the
  recorded Tokens of each trend interval — while the underlying rows travel only to
  exports, which still include every one of them.

## 0.5.0

### Minor Changes

- aaadd6b: Add dsh (DeepSeek Harness) as a Provider, read from its local session logs. Every profile of
  one dsh home counts, including terminal front ends composed on dsh such as codsh, which keep
  no usage of their own. dsh reports Tokens and history with no subscription quota, and its
  billing domains are dsh provider route keys, so a request is attributed to the route that
  answered it instead of being labelled as DeepSeek spend. Cost is the API retail equivalent at
  DeepSeek's published peak/off-peak rates. A log that declares an unknown on-disk format
  version is skipped and named rather than partially trusted, and an unfinished final frame —
  what a reader sees mid-append — keeps the complete records before it.

### Patch Changes

- 79e1f0c: Look for a starting daemon over a plain socket instead of a request abandoned after half a
  second. Waiting out a cold start asked well over a hundred times, and Node can throw
  `setTypeOfService EINVAL` from inside its own socket callbacks when one is torn down at the
  wrong moment, past the `try` around it, ending the command instead of opening the dashboard.
- da29cb9: Wait for the development daemon and Vite over a plain socket instead of requests abandoned
  after half a second. An abandoned request can throw from inside Node's own HTTP client
  callbacks, past the `try` around it, ending the development run while it was still starting.

## 0.4.1

### Patch Changes

- c0e3a25: Read Codex history from `archived_sessions` as well as `sessions`. Codex moves finished
  rollouts into the archive after a few days, so local evidence used to disappear as it aged:
  recent days kept their model detail while older ones collapsed into an unclassified
  reconciled remainder and lost their API retail equivalent.
- c0e3a25: Store a Codex account day only once it has closed and reconciles against the local
  transcripts. The account profile finishes aggregating a day some hours after it ends, so its
  newest bucket is partial; a partial bucket no longer replaces the transcripts it is smaller
  than, which used to erase a whole day of recorded Tokens while its API retail equivalent
  still counted.

## 0.4.0

### Minor Changes

- 3fe05a4: Add a subscription value view to the Token and model cost panel. Declare what each plan costs in Settings — from a sourced preset catalog or your own amount, currency, and billing period — and the dashboard prorates that price over the selected window and compares it with the API retail equivalent of the Tokens the plan produced. A scatter map places each subscription against a break-even line with 2x/5x/10x references and sizes each point by Token volume, and a ranking lists the value multiple beside what a million Tokens actually cost you and what the same Tokens are worth at list price. Partly priced Tokens make the multiple an explicit lower bound, an unknown retail equivalent leaves it unavailable rather than zero, and metered billing domains stay listed separately with their own actual cost. Declaring a renewal date adds each subscription's own billing period beside that: the cycle is measured from its own start to now against the whole period price, and reports how far into the cycle it is with a break-even pace marker, so a plan in its first week is never read against one in its fourth. The plan price is a local declaration: it never becomes a cost record and never enters any cost total or trend.

### Patch Changes

- 090d817: Replace the legacy README banner with the stitched dashboard showcase in both languages.
- 3d98ca7: Replace long model-detail lists with compact ECharts Token-category and activity views while keeping full audit evidence on demand.
- 86bccd1: Drop the Provider colour legend from the quota timeline: every lane already carries its Agent name and colour, so the legend keeps only the current, elapsed, and upcoming window styles.
- 3fe05a4: Drop the unclassified usage row from the Token and model cost breakdown so the panel ends with the model ranking.
- 361bf1d: Open model details immediately by deferring charts and large audit tables while reducing evidence preprocessing work.
- 67ae6b7: Remove the low-priority audit section from model detail dialogs.
- 86bccd1: Keep dashboard data visible without inserting a layout-shifting workbench banner while refreshing, load every Agent provider independently, preserve Agent names and logos during first-load skeletons, mirror the final connection and quota layout inside each Agent skeleton, show a compact updating state only on the area still refreshing, avoid reloading Agent cards on every startup processing poll, and include Provider-level quota fallbacks in the quota timeline.
- 3fe05a4: Merge each Agent card's coverage badge and connection row into one status control on the card's title line, so the connection state costs no vertical space and the billing-domain caption that only repeated the account name is gone. The quota section drops its rule above the heading, and the first-load skeleton mirrors that card again: it starts at the real heading and lays out only the quota section.
- 86bccd1: Add a stacked model trend view to the model breakdown tabs.
- 3fe05a4: Read the Token and model cost view as plain names and amounts: the headline, summary, model and day breakdowns, Provider share, cost trend, and model detail no longer print data-authority, retail-equivalent, estimate, coverage, or observation-time captions, and chart tooltips and legends carry only the name and its value.
- 86bccd1: Redraw the quota timeline whenever its data, range, mode, or theme changes so every Agent lane appears once its quota loads instead of freezing on the first Provider rendered.
- 966f519: Swap each Agent's brand mark when the theme changes instead of keeping the first-painted one, and keep the dashboard alive when a Provider payload arrives without billing domains rather than throwing and freezing every later update.
- a1c3a41: Expand model detail dialogs and their charts while retaining a full-width mobile layout.
- 86bccd1: Keep Token-category controls separate from the model-detail donut chart at desktop and mobile sizes.
- 86bccd1: Trigger one automatic recovery refresh per unchanged degraded evidence: recovery evidence is now identified by its Provider, billing domain, and category instead of a last-success timestamp that moves after every partially successful collection, the first evaluation waits for connector diagnostics instead of refreshing again once they arrive, and evidence observed while a refresh is in flight no longer rearms recovery afterwards.
- 3fe05a4: Drop the Model and Day switch from the Token and model cost breakdown: it always ranks models, with the list, treemap, and stacked trend views available directly.
- 86bccd1: Keep the Token and model cost panels perfectly still while a time-range switch refreshes: each refreshing panel now shows a thin progress line on its own top edge, instead of an in-flow notice that took the first grid cell — pushing the summary totals and cost trend into the narrow column and shifting cached content up and down as it appeared and disappeared. The wording stays available to assistive technology.
- 3fe05a4: Collect immediately when a person asks for a refresh: the dashboard's Refresh button reaches the daemon through the background processing path, which used to run every collection as if it were scheduled, so a Provider still inside its five-minute collection interval was skipped and the card kept its old update time and Token totals. Automatic recovery refreshes and daemon startup keep respecting that interval, and a refresh requested while a scheduled run is in flight now collects once that run finishes.
- 3fe05a4: Answer a manual refresh inside the Token and model cost view: the summary, analysis, and breakdown panels now show their edge progress line while the refresh request and the background collection it queues are still running, instead of leaving the header button as the only sign that anything happened.

## 0.3.0

### Minor Changes

- 907dcd2: Add an interactive ECharts quota timeline with weekly and five-hour reset-window views.

### Patch Changes

- 2f262cc: Remove quota exhaustion forecasts from provider cards and align card and quota bottoms.
- 05fef34: Remove persisted Demo Agent data automatically when the daemon starts without explicit demo mode, so ordinary development sessions cannot retain fixture providers from an earlier demo run.
- eb73653: Render the token and cost trend with Apache ECharts while keeping the dashboard's light/dark surfaces, gap language, and time-axis interactions.
- c3a4e4a: Render Provider usage share with an interactive, theme-aware ECharts donut and built-in legend and tooltip instead of a separate static chart and list.
- 4787474: Fix light-theme contrast for settings controls and actions.
- fdef4e8: Move the homepage quota timeline below the provider usage cards.
- eb73653: Include every completed OpenCode local request independently from Go quota, and reorganize the model-cost dashboard around top-level totals, Provider share charts, interactive trends, and visual model shares.
- 74a1cf4: Refine the dashboard with a unified control bar, elevated provider cards, clearer token and cost surfaces, and a more compact responsive layout.
- 1c69e6b: Price eligible OpenCode local-history models through their underlying official Provider rates so non-Go usage remains visible in model totals and OpenCode appears in the API-equivalent cost share chart.
- 148da49: Show the matching Provider usage tooltip when hovering the built-in ECharts legend.
- 66c17cb: Refine dashboard hierarchy, density, responsive model details, and long-page navigation.
- 2ae3226: Automatically refresh stale Grok Build subscription quota observations in the background on macOS.
- 2ec26d9: Remove the redundant outer card around the Token and model cost workbench.
- 8463080: Show known input, output, reasoning, and cache Token totals when classification coverage is partial.
- c632bff: Keep every known model visible when switching the breakdown between Token and cost ordering.

## 0.2.2

### Patch Changes

- 503a17d: Show local skeleton loading states when switching usage ranges and add hover, zoom, pan, and reset interactions to token and cost trends.
- 33d727e: Show OpenCode Go quota windows in short-to-long order, with the 5-hour window first.

## 0.2.1

### Patch Changes

- dac16dc: Add the official Grok mark, redesign the README banner with supported-agent icons and future expansion, and replace the dashboard banner with the compact Agent Usage logo.

## 0.2.0

### Minor Changes

- c01bd01: Add automatic Codex, Claude Code, and Grok transcript usage collection, model-level Token and cost evidence, and the public Agent Usage brand.

### Patch Changes

- 8c68176: Start the dashboard before background data processing, add per-module progress and persistent scan/pricing caches, provide a confirmed asynchronous hard rebuild, complete English and Chinese documentation, and calculate Grok 4.6 Build API retail-equivalent cost from official xAI rates.
