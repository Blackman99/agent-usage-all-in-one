# ADR 012: Separate OpenCode local history from Go quota

## Status

Accepted — 2026-08-29

## Context

OpenCode's local message database contains completed requests from every
configured underlying Provider, including OpenCode Go, DeepSeek, xAI, OpenAI,
and Anthropic. The original connector filtered that database to
`providerID = opencode-go` and then stored those requests under the Go
subscription identity. This discarded valid non-Go usage and made local Token
history appear to be subscription allowance consumption.

## Decision

OpenCode Go publishes only its official account quota. A separate `opencode`
Provider with the `local-history` billing domain publishes every completed
request from the same read-only local database. Each normalized model keeps the
underlying Provider ID as a prefix so equal model names from different sources
do not collapse.

Both connectors share one in-flight local scan. A successful scan lets the Go
connector retire legacy `opencode-request:*` and `opencode-session:*` local rows,
while the local-history connector reconciles its own
`opencode-local-request:*` snapshot. If the source read fails, neither connector
claims an authoritative empty local snapshot, so cached evidence remains.

The existing OpenCode consent authorizes both read-only operations. The Agent
usage view shows the Go quota identity; the Token and model-cost workbench shows
the local-history identity.

## Consequences

- Local OpenCode usage is complete across configured underlying Providers.
- Go subscription quota and local Tokens cannot be added together accidentally.
- Existing installations migrate without duplicating or deleting evidence on a
  transient source failure.
- OpenCode-reported costs remain reported estimates. API retail equivalent is
  calculated only when an eligible price entry matches the retained identity.
