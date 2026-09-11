![Agent Usage dashboard showcase](static/brand/agent-usage-showcase.jpg)

# Agent Usage

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/Blackman99/agent-usage-all-in-one/actions/workflows/ci.yml/badge.svg)](https://github.com/Blackman99/agent-usage-all-in-one/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-usage-all-in-one.svg)](https://www.npmjs.com/package/agent-usage-all-in-one)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Local multi-agent usage center on macOS — one dashboard, no cloud, no auto-switch.**

Agent Usage is a macOS-first, fully local usage center for Codex, Claude Code,
OpenCode, Grok, dsh, and Antigravity. One command opens a dashboard for native quota windows,
reset times, tokens, model rankings, equivalent API cost, history, and diagnostics.
It offers advice but never switches agents automatically.

## Compared

![Category comparison: provider UIs, token exporters, FinOps dashboards, and Agent Usage](docs/design/compare-sheet.png)

Honest category axes and when to prefer Agent Usage vs provider UIs, exporters, or FinOps dashboards: [docs/comparison.md](docs/comparison.md).

Sourced named competitors (ccusage, CodeBurn, Token Monitor, TokenTracker): [docs/named-competitors.md](docs/named-competitors.md).

**Boundaries:** no Cursor yet · macOS only · multi-agent usage center for listed providers (don’t oversell “all-in-one”).

## Dashboard

The dashboard has two primary tabs:

- **Agent usage** preserves each provider's native five-hour, weekly, monthly,
  All models, and Fable-only quota labels and reset times.
- **Tokens & model costs** supports 24-hour, 7-day, and 30-day ranges. The
  selected window, metric, and currency sit in the same sticky header as the
  primary tabs. The summary board leads with the headline amount beside a
  GitHub-style last-year usage wall of headline-included recorded Tokens, then
  charts Provider share and the interactive daily trend, and shows model
  rankings with visual share bars and the public API retail equivalent of
  eligible token usage. The year wall is independent of the selected 24-hour,
  7-day, or 30-day window.
- **Settings** provides a centered two-column modal organized into five dedicated
  categories: Connections, Custom model rates, Monitoring, Diagnostics, and
  Data & privacy.

Actual charges, provider-reported estimates, fixed subscription fees, and API
retail equivalents are separate evidence. The API retail equivalent is not a bill
and is never presented as subscription spend. Unknown models or prices remain
unclassified or unpriced instead of being guessed or displayed as zero.

Grok Build/SuperGrok and xAI API are independent billing domains. Their quotas,
tokens, and costs are never added together.

![Cost honesty: actual charges, estimates, subscriptions, and API retail equivalent stay separate](docs/design/cost-semantics-4.png)

## Fast, progressive startup

The loopback web service starts before connector discovery or data processing.
Cached results are available immediately while discovery, provider usage, model
pricing, and retention run as independent background modules. Each dashboard tab
shows only its own update indicator and completed sections remain usable.

Transcript scans use a persistent, path-redacted file index. Historical retail
pricing is recalculated only when the pricing catalog version changes. SQLite
time/provider/model indexes and retention compaction run in a worker after
provider collection, while price backfill processes bounded pages. Settings
includes an explicitly confirmed
**Hard rebuild all data** action for troubleshooting. It ignores these caches, can
use substantial resources, and may take a long time without blocking the web UI.

## Development

```bash
pnpm install
pnpm dev
```

This starts the source daemon, authenticated Vite proxy, hot reload, and dashboard on a random available port.
Development state is isolated in the ignored `.agent-usage-dev/` directory. Use
`pnpm dev -- --port 3000` (or `AGENT_USAGE_DEV_PORT=3000`) to customize the port,
`AGENT_USAGE_DEMO=1 pnpm dev` for demo data, or `pnpm dev -- --no-open` to keep the
browser closed.

## Install and run

Agent Usage requires macOS and Node.js 24 or newer. That floor is the supported
runtime (built-in `node:sqlite`, Keychain, LaunchAgent), not a documentation
oversight — see [ADR 017](docs/adr/017-macos-node24-npm-runtime.md) and the
[platform roadmap](docs/platform-roadmap.md). Linux and Homebrew / DMG are not
shipped.

![Quick start: install and open the local dashboard in three steps](docs/design/install-3-steps.png)

```bash
npx agent-usage-all-in-one
```

Optional global install:

```bash
npm install --global agent-usage-all-in-one
agent-usage
```

To build and install a package from source:

```bash
pnpm install
pnpm build
archive=$(pnpm pack)
npm install --global "./$archive"
agent-usage
```

The daemon binds only to `127.0.0.1`. Application data is stored under
`~/Library/Application Support/Agent Usage` by default.

Common commands:

```bash
agent-usage status --window 7d
agent-usage doctor
agent-usage export --format json --window 30d
agent-usage export --format csv --window 7d
agent-usage retention --json
agent-usage retention --compact
agent-usage monitoring --json
agent-usage start-at-login enable
agent-usage clear --yes
```

## Provider coverage

| Provider / billing domain        | Native quota                                                                                                                          | Token history                                                                             | Cost evidence                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex                            | Official account buckets when available                                                                                               | Local rollouts with account-day reconciliation                                            | API retail equivalent                                                                  |
| Claude Code                      | Experimental official-client usage, including All models and Fable only                                                               | Local session transcripts; optional OTLP supplement                                       | Client estimate and API retail equivalent                                              |
| OpenCode Go                      | Official account-wide five-hour, weekly, and monthly windows                                                                          | Kept separate from local history                                                          | Quota context only                                                                     |
| OpenCode · local history         | No subscription quota                                                                                                                 | All completed local requests across configured Providers                                  | Client-reported estimate; API retail equivalent when eligible                          |
| Grok Build / SuperGrok           | Experimental shared subscription allowance                                                                                            | Local `updates.jsonl`; optional OTLP supplement                                           | Client estimate and API retail equivalent, including recognized Grok 4.6 Build aliases |
| Grok · xAI API                   | No subscription quota                                                                                                                 | Official Management API aggregation                                                       | Actual USD amounts, balance, limit, and invoice when available                         |
| dsh · DeepSeek API               | No subscription quota                                                                                                                 | Local dsh session logs across every profile, including front ends composed on dsh         | API retail equivalent at DeepSeek published peak/off-peak rates                        |
| Antigravity · Gemini Code Assist | Official-client 5-hour sprint window and weekly baseline limit from live language server RPC, with local session observation fallback | Local conversation SQLite databases (~/.gemini/antigravity-cli and ~/.gemini/antigravity) | API retail equivalent at published Google Gemini and third-party model rates           |

Every value retains its authority and observation time. Account-wide and this-Mac
evidence remain visibly distinct.

## First launch / empty state

Until connectors find local client data, the dashboard shows an honest empty state — connect or use an installed agent first:

![Empty state when no agent data is connected yet](docs/design/empty-state-unconnected.png)

## Credentials and privacy

Official-client credentials stay in their owning clients and are neither copied
nor displayed. The optional xAI Management key is the only product-owned secret;
it is stored in macOS Keychain. The dashboard uses a one-time launch token,
HttpOnly session cookie, and same-origin mutation protection.

All usage data remains local. JSON and CSV exports omit account identifiers,
session IDs, cookies, OAuth tokens, and secret values by default. Raw observations
are retained for 90 days, then transactionally compacted into UTC daily aggregates.
Clearing local usage never deletes credentials owned by Codex, Claude Code,
OpenCode, Grok, dsh, or Antigravity.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm test:e2e
```

See the [official pricing evidence](docs/research/official-pricing-sources-2026-08-28.md),
[connector receipts](docs/release/connector-receipts-2026-08-28.md), and
[open-source notices](docs/open-source.md).

## Roadmap vision (not shipped)

Linux, Homebrew, and DMG stay off the product until the conditions in
[docs/platform-roadmap.md](docs/platform-roadmap.md) are met.

> **VISION only — not shipped.** Menu bar / always-available glance is tracked in [issue #19](https://github.com/Blackman99/agent-usage-all-in-one/issues/19). Do not treat the mock as a current feature.

![VISION (not shipped): menu bar glance concept — see issue #19](docs/design/menubar-vision.png)

## License and community

MIT — see [LICENSE](LICENSE). Also see [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
