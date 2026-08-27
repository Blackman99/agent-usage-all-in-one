# P0 validation — 2026-08-28

## Artifact

- Version: `0.1.0`
- Platform: macOS, Node.js 24+
- Package: `agent-usage-all-in-one-0.1.0.tgz`
- Package smoke: pack, clean temporary install, default loopback launch, `status`, `doctor`, `clear`, daemon shutdown, and clean uninstall passed.

## Automated gates

The release gate runs:

```text
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm test:e2e
```

Final result:

- Formatting: passed.
- Lint: passed.
- Svelte/TypeScript check: 0 errors and 0 warnings.
- Vitest: 18 files, 65 tests passed.
- Production build: passed.
- Package smoke: clean temporary install, default launch, status, doctor, clear, daemon shutdown, and clean uninstall passed.
- Playwright: 9 browser scenarios passed.
- Code review: independent Standards and Spec reviews reported no remaining actionable findings.

Security coverage injects recognizable fake secrets through connectors, sessions, source ids, Keychain references, HTTP, CLI, browser, diagnostics, and export paths. Usage values in the Dashboard and human-readable CLI output carry data authority and their real observation time; cross-domain Grok risk evidence is regression-tested.

## Known boundaries

- macOS is the only supported P0 platform; Windows and Linux packaging are out of scope.
- Grok Build quota and Claude Code quota adapters are experimental and fail closed on unknown versions or schema.
- Grok Build live client behavior is unverified on this host because the executable is absent.
- xAI API live account behavior is unverified because no dedicated Management key was supplied.
- Provider cost remains unknown when an official source does not expose it; unknown is never converted to zero.
- Recommendations are read-only and never switch agents.
