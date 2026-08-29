# agent-usage-all-in-one

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
