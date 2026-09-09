# Specification: Usage Contribution Wall

Status: landing
Branch: ship/usage-contribution-wall
Base-Commit: 6e54a1a7a099d6f2393a73ff0ccb6f731bfc5ad3
Original-Branch: main

## Requirement

Add a GitHub-style last-year usage wall to Tokens & model costs.

## Problem Statement

Tokens & model costs already answers “how much in this 24-hour, 7-day, or 30-day window” with totals, a Provider-share pie, and an interactive line trend. It does not answer “which days this year did I actually use agents, and how heavy were those days relative to each other.”

A developer scanning a year of local usage therefore cannot see presence the way GitHub’s contribution graph shows it: weekday rows, month columns, empty versus busy days, and a single year total. The existing 30-day trend is too short, and stretching that line across a year would hide the calendar shape the screenshot asks for.

## Solution

On the Tokens & model costs tab, above the Provider-share pie and line trend, render a GitHub-style contribution wall for the rolling last year:

- Heading: compact recorded Tokens plus a Tokens caption (for example “1.2M recorded Tokens in the last year”).
- Calendar: Sunday-start week columns ending this week, weekday labels Mon/Wed/Fri (or 一/三/五), month labels, GitHub-like five-level greens, and a Less/More legend.
- Each day cell is the sum of headline-included recorded Tokens for that local day. Empty days stay empty. Hover and keyboard focus share one tooltip. Click does not change 24h/7d/30d.

The wall is independent of the existing history-window toggle. That toggle still drives totals, pie, and trend only.

## Grill Decisions

- **Placement**: Full-width on Tokens & model costs, above the pie/trend grid. The wall is Token-year presence, not a quota card, so it does not belong on Agent usage.
- **Time range**: Always the rolling last 12 months, independent of 24h/7d/30d. A new `1y` workbench window was rejected so the existing window contract and ADR 008 trend buckets stay unchanged.
- **Cell metric**: Recorded Tokens always. Cost/Tokens still drives pie and trend; unpriced days must still light up.
- **Provider mix**: One cell per day summing only headline-included recorded Tokens. Sibling billing domains (for example xAI API) never darken a cell or enter the year total, matching ADR 008 headline rules.
- **Interaction**: Hover/focus tooltip only. Click does not invent a 1-day workbench filter and does not pan the line trend.
- **Color**: GitHub-like five greens, adapted to light and dark theme surfaces. Intensity is relative to this Mac’s year, not a fixed Token scale and not per-Provider hues.
- **Heading**: Compact recorded Tokens plus a Tokens caption. Not a GitHub-style contribution count and not an active-day count as the primary figure.
- **Week start**: Sunday-start columns in every locale, matching the screenshot. Day membership still uses the dashboard time zone. Labels follow the UI locale.
- **Tooltip**: Date plus compact Token total, or a no-usage line for empty days; list headline Providers that contributed that day. Sibling-domain amounts stay out of the tooltip.
- **Intensity scale**: Level 0 if no Tokens; otherwise quartiles of this year’s positive daily headline Token totals. Equal-width bins of the year’s maximum would flatten typical weeks after one outlier day.
- **Today and future**: Include today’s in-progress headline recorded Tokens so the wall does not lag the 7-day trend. Do not render days after today.
- **Chrome**: Heading plus Less/More five-swatch legend. No Contribution settings menu and no GitHub “learn how we count” link.
- **Access**: Each day is a focusable grid cell whose accessible name is the tooltip text. No extra 365-row table.
- **CLI**: Dashboard only this ship. No CLI calendar and no JSON year field on existing CLI summary.
- **First-week padding**: Do not render cells before the year start. The first column may have fewer than seven cells.
- **Narrow screens**: Keep GitHub-like cell size and scroll the wall horizontally rather than shrinking squares or hiding the wall.
- **Refresh**: Changing 24h/7d/30d does not reload the wall. Manual Refresh and completed collection do, without wiping already-rendered squares.

## User Stories

1. As a developer reviewing Tokens & model costs, I want a last-year usage wall above the pie and trend, so that I can see which days this year had agent usage without leaving the analysis tab.
2. As a developer switching 24h, 7d, and 30d, I want the wall to stay on the last year, so that a short window change does not collapse the calendar I am scanning.
3. As a developer with unpriced custom-endpoint Tokens, I want those days to still light up, so that the wall shows activity even when API retail equivalent is unavailable.
4. As a developer using Grok Build and xAI API together, I want only headline-included Tokens in each cell and in the year total, so that sibling domains do not inflate the wall the way they must not inflate workbench headlines.
5. As a developer hovering or focusing a day, I want the date, compact Token total or a no-usage message, and the headline Providers that contributed, so that I can read a day without opening a different view.
6. As a developer clicking a day, I want nothing about 24h/7d/30d to change, so that exploring the calendar cannot fight the window I already selected.
7. As a developer on a light or dark theme, I want five GitHub-like greens that remain readable on that surface, so that empty versus busy days stay obvious.
8. As a developer with one extremely busy day, I want the other active days to still occupy quartile greens rather than collapsing to the lowest step, so that a typical week remains readable.
9. As a developer using the dashboard during the day, I want today’s square to include in-progress headline Tokens, so that the wall agrees with the current 7-day trend’s last bucket.
10. As a developer looking at the current week, I want days after today omitted, so that I cannot hover tomorrow as “no usage.”
11. As a developer whose year starts mid-week, I want days before the year start omitted, so that padding squares cannot be read as empty usage.
12. As a Chinese-locale user, I want Sunday-start columns with 一/三/五 and localized month labels, so that the wall matches the screenshot’s week geometry while reading in my UI language.
13. As a keyboard or screen-reader user, I want each day to be a focusable cell named with the tooltip text, so that I can traverse the year without a hidden 365-row table.
14. As a developer on a narrow dashboard, I want the wall to keep readable cell size and scroll horizontally, so that squares stay hoverable and tappable.
15. As a developer with no usage this year, I want “0 recorded Tokens in the last year” and an empty-looking wall, so that missing history is not an error state.
16. As a developer refreshing or waiting for collection to finish, I want the wall to update without wiping squares, so that a year of cells does not flash empty during reload.
17. As a developer using the CLI, I want existing summary commands unchanged, so that this dashboard-only view does not invent a calendar contract in the terminal.

## Implementation Decisions

- **Read-model ownership**: The wall is an application-owned year read model, not a new `HistoryWindow` and not a stretch of ADR 008’s 24/7/30 trend buckets. The existing window query remains `24h | 7d | 30d`.
- **HTTP contract**: Expose the year wall through a dedicated loopback read, for example `GET /api/usage-wall`, taking dashboard `timeZone` and ignoring `window`. Do not attach ~53 weeks of cells to every `/api/overview` workbench response, because window toggles must not reload the wall.
- **Day membership**: A day is the local calendar day in the dashboard time zone. The range is from the local day one year before today through today inclusive. Week columns start on Sunday. Cells before the range start and after today are absent, not empty-with-zero.
- **Headline Token rule**: Each day’s `recordedTokens` is the sum of recorded Tokens from billing domains that the owning Provider includes in headlines (`includedInHeadline`). Sibling domains remain identified in other workbench views and never enter wall cells, tooltips, or the year total.
- **Evidence sources**: Raw observations are retained for 90 days; `daily_usage_aggregates` already persist compacted days but are currently write-only. The wall must read both: live additive observations for the recent window including today, and compacted daily aggregates for older days in the year. A day with no retained evidence is a gap (level 0), never filled from cost records or guessed.
- **Today**: Today uses current in-progress headline observations, not a requirement that the day be settled in storage. This is a display of the same live evidence the 7-day trend already shows for its last bucket, not a new stored day total that would violate invariant 2.
- **Intensity**: Collect the positive daily headline Token totals in the rendered year. Level 0 is no Tokens. Levels 1–4 are quartiles of those positive totals (ties keep a stable order by day). An all-zero year has every rendered cell at level 0.
- **Presentation module**: A pure projection builds the week grid, month labels, levels, year total, and per-day tooltip model from the read model plus locale. The Svelte wall renders that projection: heading, scrollable calendar, legend. It does not recompute headline rules or quartiles in ad-hoc markup.
- **Visual language**: Five GitHub-like greens as theme tokens for light and dark. Empty cells are muted squares. Legend order is Less → five swatches → More. No settings control and no GitHub help link.
- **Copy**: English and Simplified Chinese catalogs gain heading, Tokens caption, empty-day tooltip, usage-day tooltip, weekday labels, Less/More, and wall updating text. Compact number formatting matches the workbench headline.
- **Loading**: The Tokens tab fetches the wall on load, on manual Refresh, and when background collection completes. Switching 24h/7d/30d, Cost/Tokens, or CNY/USD does not refetch it. While updating, keep the previous grid visible and expose an updating status on the wall section.
- **Access**: The calendar is a grid of focusable day cells. Each cell’s accessible name is the tooltip string. Month and weekday labels are not interactive. There is no parallel year table.

## Testing Decisions

A good test here proves external year-wall behavior: which local days exist, which Tokens enter a cell, which level a day gets, and what the dashboard shows a person. It does not assert SQLite SQL, CSS class names, or Svelte internals.

**Primary seam (one public seam):** the year-wall read model returned by the application (loopback `GET /api/usage-wall` or the repository/application method that JSON encodes). Integration tests at that seam are the source of truth for calendar bounds, headline filtering, today inclusion, aggregate-plus-raw merging, and quartile levels.

**Secondary seam:** dashboard Playwright on Tokens & model costs, following `tests/e2e/dashboard.spec.ts` workbench fixtures. Prove the wall is visible above pie/trend, independent of the window toggle, bilingual enough via i18n catalog completeness, and that day cells expose tooltip-equivalent accessible names.

**Prior art:** `tests/integration/token-money-workbench.test.ts` for headline versus sibling-domain isolation; `tests/unit/usage-trend.test.ts` and `tests/unit/provider-share.test.ts` for pure chart projections; `tests/unit/i18n.test.ts` for catalog key parity; `tests/e2e/dashboard.spec.ts` for Tokens tab layout.

Prefer one focused unit module for the calendar projection (week columns, omitted padding days, quartile assignment, tooltip model) so the integration seam can stay about data truth rather than grid arithmetic.

## Out of Scope

- A new `1y` (or `1d`) workbench history window.
- Replacing or removing the existing line trend.
- CLI or export of a year calendar.
- Click-to-filter the workbench to one day.
- Per-Provider colored cells, stacked walls, or sibling-domain amounts in tooltips.
- Contribution settings, GitHub help links, or a learn-how-we-count caption.
- Changing raw retention (90 days) or compaction policy beyond reading the aggregates that already exist.
- Combining unlike cost purposes into cell intensity.
- Rendering days after today or days before the rolling year start.

## Acceptance Criteria

1. **Year-wall read model: headline Tokens, today, and no future/padding days**

   Command:

   `pnpm exec vitest run tests/integration/usage-contribution-wall.test.ts`

   Passing: exit code 0. The suite proves:
   - the wall range is the rolling local year through today;
   - today is present and includes in-progress headline recorded Tokens;
   - days after today are absent;
   - days before the year start are absent;
   - sibling billing domains do not add to a cell or the year total;
   - compacted daily aggregates contribute days older than raw retention;
   - a day with no evidence is level 0;
   - positive days map to quartile levels 1–4 of that year’s positive totals;
   - an empty year returns total 0 and level-0 cells.

2. **Calendar projection: Sunday-start grid, locale labels, tooltip model**

   Command:

   `pnpm exec vitest run tests/unit/usage-contribution-wall.test.ts`

   Passing: exit code 0. The suite proves Sunday-start columns, omitted leading/trailing cells, English and zh-CN weekday/month labels, compact Token heading inputs, and tooltip strings for empty versus used days including headline Provider names.

3. **Dashboard wall on Tokens & model costs**

   Command:

   `pnpm exec playwright test tests/e2e/dashboard.spec.ts -g "usage contribution wall"`

   Passing: exit code 0. The matching tests prove the wall is on Tokens & model costs above the analysis grid, shows the year heading and Less/More legend, exposes focusable day cells whose accessible names match the tooltip copy, does not change when switching 7d ↔ 30d, and does not appear on Agent usage.

4. **i18n catalogs stay complete**

   Command:

   `pnpm exec vitest run tests/unit/i18n.test.ts`

   Passing: exit code 0, English and Simplified Chinese keys remain equal, including the new wall strings.

5. **Typecheck**

   Command:

   `pnpm typecheck`

   Passing: `svelte-check found 0 errors and 0 warnings` (or the same zero-error, zero-warning summary the baseline records).

6. **Full unit and integration suite, no new failures versus baseline**

   Command:

   `pnpm test`

   Passing: exit code 0, zero new failures against the Phase 3 baseline recorded in this spec.

7. **Format**

   Command:

   `pnpm format:check`

   Passing: `All matched files use Prettier code style!`

## Plan

- [x] Ticket 1: Empty year wall tracer — Delivers `GET /api/usage-wall` empty-year read model, Sunday-start calendar projection, Tokens & model costs wall with compact “0 recorded Tokens in the last year” heading, Less/More legend, and bilingual strings (Blocked by: none)
- [x] Ticket 2: Headline Token days, today, aggregates, and quartiles — Delivers daily cells from live observations plus compacted `daily_usage_aggregates`, sibling-domain exclusion, today’s in-progress Tokens, omitted future/padding days, quartile levels 0–4, and tooltips that list headline Providers (Blocked by: Ticket 1)
- [x] Ticket 3: Window independence, refresh, access, and layout — Delivers wall fetch independent of 24h/7d/30d, refresh/collection update without wiping squares, focusable day cells whose accessible names match tooltips, horizontal scroll at GitHub cell size, and no wall on Agent usage (Blocked by: Ticket 2)
- [ ] Ticket 4: Release & Documentation Compliance — Delivers Changeset and bilingual documentation updates (README.md and README.zh-CN.md) (Blocked by: Ticket 3)

## Baseline

Recorded on `ship/usage-contribution-wall` at `6e54a1a7a099d6f2393a73ff0ccb6f731bfc5ad3` before implementation.

- `git status --porcelain`: `?? docs/specs/usage-contribution-wall.md` (spec only)
- `pnpm typecheck`: Passed — `svelte-check found 0 errors and 0 warnings`
- `pnpm test`: Passed — 57 test files, 327 tests
- `pnpm format:check`: Passed — `All matched files use Prettier code style!`
- `pnpm exec vitest run tests/integration/usage-contribution-wall.test.ts tests/unit/usage-contribution-wall.test.ts`: Failed, exit code 1 — `No tests found` (pre-implementation)
- `pnpm exec playwright test tests/e2e/dashboard.spec.ts -g "usage contribution wall"`: Failed, exit code 1 — no matching tests (pre-implementation)

Green for this feature means the new proof files pass and `pnpm test` stays at 327 plus the new tests, with zero new failures.
