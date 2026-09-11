# Platform and distribution roadmap

Agent Usage is **macOS-only** and **Node.js 24+** today. That is a product
boundary, not a temporary README omission. ADR 017 records why.

This note is the Linux / packaging roadmap required by issue #21. It does not
claim Linux or Windows work.

## Shipped

| Surface        | What exists                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Platform       | macOS. Data directory is `~/Library/Application Support/Agent Usage`.                                              |
| Runtime        | Node.js ≥ 24. Persistence uses `node:sqlite`.                                                                      |
| Secrets        | Product-owned keys in macOS Keychain (`SecretStore`). Official-client credentials stay in those clients (ADR 003). |
| Notifications  | `osascript` banners. Not a menu-bar extra.                                                                         |
| Start at login | LaunchAgent written by the daemon.                                                                                 |
| Install        | Canonical: `npx agent-usage-all-in-one`. Secondary: global npm.                                                    |

## Named seams (not abstracted yet)

These modules are the Linux work, when Linux is actually in scope:

- Application data directory (`defaultHome()` in the CLI)
- `SecretStore` (today `MacOsKeychainSecretStore` → `/usr/bin/security`)
- `LocalNotifier` (today `MacOsNotifier` → `osascript`)
- `StartAtLoginManager` (today LaunchAgent plist)

Do not introduce a platform facade in the running product until a Linux CI job
exercises those seams. README must keep saying macOS-only until that job exists
and a Linux runtime ships.

## Not shipped

- Linux or Windows data directories, secret stores, or notifiers
- Homebrew formula / cask
- DMG, `.app`, or any updater
- Menu bar glance (tracked as [issue #19](https://github.com/Blackman99/agent-usage-all-in-one/issues/19); vision mock is not a feature)
- Cursor (tracked as [issue #18](https://github.com/Blackman99/agent-usage-all-in-one/issues/18); blocked on local evidence, not a coverage claim)

## Revisit when

1. **Menu bar extra** attaches to the existing loopback daemon without changing
   the npm install channel.
2. **A distributable macOS runtime** exists (signed helper or `.app` that is not
   “whatever Node the user has”). Only then is Homebrew / DMG in scope again.
3. **Linux CI** runs the test suite against a non-Keychain `SecretStore` and an
   XDG data directory. Only then is path abstraction in the running product in
   scope.

Until then, npm / `npx` on macOS with Node 24 is the whole distribution story.
