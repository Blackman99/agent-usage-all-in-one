# Specification: Settings Panel Layout & Presentation Redesign

Status: landing
Branch: ship/settings-layout-redesign
Base-Commit: 741c5195febcbe086614c286286513de5926b18d
Original-Branch: main

## Requirement

设置面板内容过多，排版跟展示方式重新考虑下

## Problem Statement

Currently, the Agent Usage settings panel is implemented as a narrow right-side slide-over drawer (`.settings-drawer`, max 680px width) where all five functional domains (Connections, Custom Model Rates, Monitoring & Autostart, System Diagnostics, and Data Retention & Privacy) are vertically stacked inside a single, continuous scroll container.

This layout creates several usability problems:

1. **Excessive Vertical Clutter**: Users looking for monitoring toggles or data exports must scroll past dozens of large connector cards and a permanent six-input custom pricing form.
2. **False Navigation Model**: The top navigation buttons act merely as smooth scroll jumps rather than isolating views. Scrolling through the drawer causes the active button to fall out of sync, and users must scroll all the way back to the top to switch context.
3. **Hidden Diagnostics**: Diagnostics lacks its own navigation button entirely, resting sandwiched between Monitoring and Privacy with no direct tab anchor.
4. **Form Footprint**: The custom model rate creation form occupies extensive vertical space even when the user just wants to review existing rate overrides.

## Solution

Redesign the settings panel into a centered, modern two-column modal window:

1. **Two-Column Master-Detail Layout**: A left sidebar (`.settings-sidebar`) provides clean, distinct category navigation, while the right pane (`.settings-main`) renders exclusively the active category with its own dedicated scrollable body.
2. **Five First-Class Categories**:
   - **Connections** (`connections`): Provider discovery, credentials, and connector statuses.
   - **Custom Model Rates** (`rates`): Custom token pricing overrides with a compact list and collapsible "+ Add Rate" form.
   - **Monitoring & Autostart** (`monitoring`): Background refresh, macOS notifications, and login launch preferences.
   - **System Diagnostics** (`diagnostics`): Health diagnostics, degraded connector states, and recovery instructions.
   - **Data & Privacy** (`privacy`): Retention stats, JSON/CSV exports, credential deletion, and hard rebuild.
3. **Collapsible Custom Rate Form**: The custom rate editor collapses into an elegant "+ Add Rate" action, keeping the existing rate list prominent.
4. **Responsive Adaptation**: On screens narrower than 768px, the sidebar shifts into a horizontal scrollable tab bar at the top, ensuring comfortable touch navigation without cramped columns.
5. **Full Deep-Link Compatibility**: All existing deep links (e.g. `?settings=connector:<id>`, `?settings=diagnostic:<id>`) automatically switch to the correct parent tab and smoothly scroll/highlight the target card.

## Grill Decisions

- **Container Architecture**: Centered two-column modal window instead of a right-hand drawer. A centered modal provides a comfortable 860px width with natural eye movement and visual balance on desktop screens.
- **Navigation Category Split**: 5 distinct categories (Connections, Custom Rates, Monitoring, Diagnostics, Data & Privacy). Diagnostics is promoted to a first-class category rather than hidden inside other sections.
- **Custom Rate Form Presentation**: Collapsible form with a primary "+ Add Custom Rate" button, preventing form inputs from pushing existing rates offscreen.
- **Narrow-Screen Strategy**: Top scrollable tab bar for viewports < 768px, maintaining full width for complex forms and connector cards.
- **Deep-Link Behavior**: Route targets directly to their parent category tab and apply an accent focus ring to the specific element.

## User Stories

- **US-1**: As a developer configuring agent clients, I want to open the Connections tab in a focused view so that I can connect or skip providers without distraction from rate forms or export buttons.
- **US-2**: As a developer setting custom endpoint rates, I want to see my configured rates in a clear list and expand the creation form only when adding a new model rate.
- **US-3**: As a developer troubleshooting a connector error, I want to navigate directly to the Diagnostics tab so that I can inspect degraded components and recovery advice immediately.
- **US-4**: As a user tuning system preferences, I want separate Monitoring and Privacy tabs so that daily background collection settings and destructive data actions are clearly segregated.
- **US-5**: As a user following in-app doctor alerts or deep links, I want the modal to automatically select the appropriate category tab and focus the relevant diagnostic or connector card.

## Implementation Decisions

- **Dialog Shell & Semantics**: Replace `.settings-drawer` with `.settings-dialog` using native WAI-ARIA modal dialog patterns (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="settings-heading"`).
- **Navigation Architecture**:
  - The left sidebar (`<nav class="settings-sidebar" aria-label="Settings Categories">`) renders vertical category buttons.
  - Active tab state `settingsTab: 'connections' | 'rates' | 'monitoring' | 'diagnostics' | 'privacy'` controls which panel is active.
  - Deep-link resolution automatically maps target prefixes (`connector:` -> `'connections'`, `diagnostic:` -> `'diagnostics'`) to their corresponding `settingsTab`.
- **Component Styling & Layout**:
  - Desktop: `display: grid; grid-template-columns: 220px 1fr;` with fixed height (`min(640px, 86vh)`) and width (`min(880px, 94vw)`).
  - Mobile (< 768px): `display: flex; flex-direction: column;` with sticky horizontal navigation.
- **Visual Design**:
  - Preserves the project's dark theme palette (`var(--surface)`, `var(--surface-subtle)`, `var(--border-soft)`, `var(--text-strong)`).
  - Clean card borders, tabular typography, and subtle focus rings for accessibility.
- **Internationalization (`src/lib/i18n.ts`)**:
  - Add navigation labels for `diagnosticsNav` in both English and Simplified Chinese to complement `customRatesNav`, `connections`, etc.

## Testing Decisions

- **Public Seams**: Tested through user interactions on the UI and URL synchronization:
  - Settings button opens centered dialog.
  - Category tab clicks switch active content panel without scrolling other panels.
  - Deep links (`?settings=diagnostic:<id>`, `?settings=rates`, etc.) correctly display the target tab and element.
  - Adding/editing custom rates inside the new collapsible form operates seamlessly.
- **Prior Art**: Extends existing tests in `tests/e2e/dashboard.spec.ts` and unit tests in `tests/unit/i18n.test.ts`.

## Out of Scope

- Modifying connector verification, OTLP ingestion, or SQLite persistence logic.
- Adding new settings categories or configuration fields beyond current capabilities.
- Changing CLI command-line arguments.

## Acceptance Criteria

1. **Typecheck passes cleanly**:
   `pnpm typecheck`
   Expected output: `svelte-check found 0 errors and 0 warnings`

2. **Lint check passes cleanly**:
   `pnpm lint`
   Expected output: exit code 0, 0 errors, 0 warnings

3. **Format check passes cleanly**:
   `pnpm format:check`
   Expected output: `All matched files use Prettier code style!`

4. **Full unit & integration test suite passes**:
   `pnpm test`
   Expected output: `55 passed` (all test suites pass)

5. **E2E verification of settings dialog and tab navigation passes**:
   `pnpm test:e2e tests/e2e/dashboard.spec.ts -g "settings"`
   Expected output: all matching tests pass with exit code 0

## Plan

- [x] Ticket 1: Settings Dialog Shell & 5-Category Master-Detail Navigation Architecture — Delivers centered modal shell, left category sidebar, and active tab state routing (Blocked by: None)
- [x] Ticket 2: Category Content Isolation & Diagnostics First-Class View — Delivers per-tab view isolation, dedicated Diagnostics panel with i18n nav labels, and deep-link element scrolling/highlighting (Blocked by: Ticket 1)
- [x] Ticket 3: Custom Rates Collapsible Form & Compact Presentation — Delivers collapsible "+ Add Rate" form toggle, compact overrides list, and updated form styling (Blocked by: Ticket 2)
- [x] Ticket 4: Responsive Layout Adaptation & Visual Polish — Delivers <768px top tab bar conversion, full-width responsive controls, and refined dark theme styles (Blocked by: Ticket 3)
- [ ] Ticket 5: E2E Test Suite Alignment & Regression Coverage — Delivers updated and expanded settings tests in `tests/e2e/dashboard.spec.ts` (Blocked by: Ticket 4)
- [ ] Ticket 6: Release & Documentation Compliance — Delivers changeset file and updated README documentation (Blocked by: Ticket 5)

## Baseline

- `git status --porcelain`: Clean (excluding spec file)
- `pnpm typecheck`: Passed (0 errors, 0 warnings)
- `pnpm lint`: Passed (0 errors, 0 warnings)
- `pnpm format:check`: Passed
- `pnpm test`: Passed (55 test files, 303 tests passing)
