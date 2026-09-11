# ADR 017: Supported runtime stays macOS, Node.js 24, and npm

- Status: accepted
- Date: 2026-09-11

## Context

GitHub issues #17, #21, and #23 asked whether the product should lower
`engines.node` to 22, abstract paths for Linux, or ship Homebrew / DMG. Those
look like three distribution tickets. They are one product-shape question:
is Agent Usage still a macOS-local Node CLI that opens a loopback dashboard,
or is it becoming a cross-platform desktop app with a second install channel.

Persistence already uses `node:sqlite` (`DatabaseSync`). On Node.js 22 that
module is experimental (stability 1.1; flagless only from 22.13). On Node.js 24
it is a release candidate. Application data lives under
`~/Library/Application Support/Agent Usage`. Product-owned secrets go through
`/usr/bin/security` (macOS Keychain). Notifications use `/usr/bin/osascript`.
Optional start-at-login writes a LaunchAgent. CI and `tsup` target Node 24 on
macOS because those seams are the supported runtime, not a convenience.

Homebrew and a DMG would invent a second install semantic while the shipped
artifact is still an npm package whose daemon is a Node process. Linux would
need a data-directory equivalent, a `SecretStore` that is not Keychain, and a
notifier that is not `osascript`, plus CI that actually runs there.

## Decision

The supported product remains **macOS + Node.js ≥ 24**, distributed through
**npm / `npx`**.

1. Do not lower `engines.node` to 22. Claiming 22 would put the usage database
   on an experimental SQLite API. README, CI, and the package target stay 24.
2. Linux is a documented roadmap, not a shipped platform. Named seams are the
   application data directory, `SecretStore`, notifications, and start-at-login.
   Do not abstract those in the running product until a Linux CI job exists.
   README must keep saying macOS-only until a Linux runtime actually ships.
3. Homebrew formulae and DMG / `.app` installers are **no-go** until there is a
   distributable macOS runtime that is not “Node plus npm”. Canonical install
   stays `npx agent-usage-all-in-one` (global npm is secondary). A later
   menu-bar extra (#19) may attach to the existing daemon; it does not by itself
   change the install channel.

User-declared subscription monthly fees stay out of the dashboard. ADR 007
already forbids mixing cost purposes and allocating a fixed subscription onto
Token observations. Retired ADR 014 already tried a separate declaration table
and was removed. A new cost-purpose ADR is required before that UI returns.

## Considered options

- **Node ≥ 22 with a CI matrix.** Rejected: the database path is still
  experimental on 22.x, and “if feasible” in #17 is not met.
- **Abstract paths now, keep README macOS-only.** Rejected: it spends complexity
  on a platform with no test job and no promised ship date.
- **Ship brew/DMG for the current CLI.** Rejected: it duplicates npm without an
  updater, signing story, or bundled runtime.

## Consequences

Issues #17, #21, and #23 are answered by this decision rather than by runtime
refactors. A future Linux or desktop-packaging effort starts with CI and a
runtime, then an ADR that supersedes this one.
