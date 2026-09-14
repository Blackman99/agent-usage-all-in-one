# Cursor's first official-client surface is experimental `/usage`

- Status: accepted
- Date: 2026-09-13

## Context

Cursor Agent CLI has no `usage` JSON subcommand. `agent about` reports only
`subscriptionTier`. Local `store.db` chat blobs have no source-reported Token
fields. The official client does expose an interactive `/usage` pager
(`usage-pager.tsx`) whose standard model prints Included / Auto / API
percent-used plus On-Demand as dollars against a spend limit, with plan name
and billing-cycle reset. That pager is filled by in-process dashboard RPCs
(`GetCurrentPeriodUsage`, `GetHardLimit`, `GetPlanInfo`). Replaying those RPCs
with copied credentials would violate ADR 003. Community scrapers that call
`api2.cursor.sh` with `cursorAuth/accessToken` are the same violation.

Claude Code already collects quota by spawning the official client and parsing
`/usage` as an experimental connector.

## Decision

Admit Cursor through that same experimental `/usage` scrape. Drive the
installed `agent` binary with `--trust --mode ask` on a real TTY in a
throwaway directory, accept `/usage` from the slash menu, and parse
**printed TUI labels** (not full ANSI frames).
Fixtures are label-level transcripts, including compact layout, and may be
authored from the official formatters plus a live Free/unavailable capture.
A paid-account ANSI dump is not required to start. Internal dashboard models
may name expected labels; they are not an input. Inherit the user
environment so an existing `CURSOR_API_KEY` still authenticates the child,
and pin `LC_ALL`/`LANG` to `en_US.UTF-8`; do not persist that key. Do not
delete `~/.cursor` chat metadata the spawn creates. Connecting is consent
to spawn. A successful "not available for this plan" or spend-chart page is
a complete zero-window snapshot; timeout, parse failure, and "Not logged
in" are quota-read failures. Optionally run documented `agent about --format json` for
`accountIdentifier` only. Do not copy credentials, call dashboard protobufs,
or intercept them from the child process. Do not run headless `agent -p` to
create Token observations. Expected coverage is quota only. An unparsed live
TUI is unavailable quota, not a guessed percentage. Cursor is not a listed
Provider until this scrape and the shared quota-row display (used amount,
disabled on-demand, reset labels) ship together. The billing domain display
name stays `Cursor subscription`.

## Consequences

- Cursor can become a Provider without waiting for a JSON CLI that does not
  exist.
- The scrape is brittle and stays experimental, like Claude Code.
- The screen's Included / Auto / API cut is not Cursor Models vs Other Models.
  First-version buckets are Included and On-Demand on `cursor-subscription`.
  Auto and API are not stored. A spend-chart or "not available for this plan"
  layout leaves quota unavailable.
- Parser tests fail closed when labels change; they do not fall back to RPC.
