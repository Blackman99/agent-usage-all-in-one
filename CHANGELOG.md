# agent-usage-all-in-one

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
