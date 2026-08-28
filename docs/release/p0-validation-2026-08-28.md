# Usage-first Dashboard V2 release validation — 2026-08-28

## Artifact

- Version: `0.1.0`
- Platform: macOS, Node.js 24+
- Package: `agent-usage-all-in-one-0.1.0.tgz`
- Baseline: V2 work is reviewed from commit `41710fd`.
- Package smoke: pack, clean temporary install and Home, default loopback launch,
  `status`, `doctor`, redacted JSON/CSV `export`, `retention`, idempotent
  `retention --compact`, scoped `clear`, daemon shutdown, and clean uninstall passed.

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

Current result:

- Formatting: passed.
- Lint: passed.
- Svelte/TypeScript check: 0 errors and 0 warnings.
- Vitest: 33 files, 118 unit, integration, Connector-contract, HTTP, CLI, migration,
  privacy, and security tests passed.
- Production build: static Dashboard and packaged CLI passed.
- Package smoke: all lifecycle commands listed above passed in a temporary install
  and temporary application Home.
- Playwright: 14 Dashboard scenarios passed.
- Lighthouse desktop navigation audit: Accessibility 100 and Best Practices 100.
- Independent Standards/Spec review: the first fixed-point pass from `41710fd`
  identified migration evidence, model/unclassified conservation, alias pricing,
  export auditability, recovery actions, preference persistence, and numeric-evidence
  gaps. Those hard findings are fixed and regression-tested; the final pass remains
  pending until the complete gate below is rerun.

Security coverage injects recognizable fake secrets through connectors, sessions,
source ids, Keychain references, HTTP, CLI, browser, diagnostics, and export paths.
Usage values in the Dashboard and human-readable CLI output carry data authority and
their real observation time; cross-domain Grok isolation is regression-tested.

## Browser acceptance receipt

The 14-scenario browser suite covers the usage-first order, contextual connection
actions, settings drawer, 7-day default, persisted 24h/7d/30d windows, CNY/USD,
Token/retail trends, Top 5 ranking, model detail, unclassified usage, independent
Grok billing-domain tabs, redacted export, scoped clear, degraded-state isolation,
complete Chinese/English catalogs, keyboard focus, reduced motion, and local-only
official artwork.

Connection recovery now refreshes usage and diagnostics for connect, retry, and skip;
an already connected product-managed credential can be replaced in place. Currency and
time-window preferences both survive reload. Provider cards keep the recorded total and
its evidence visible while detailed Token categories remain collapsed until requested.

Responsive evidence uses one column at 390px, two columns at 1280px and 1440px,
and four columns at 1680px. A live-data review found 1440px too narrow for four
quota-heavy cards; the four-column breakpoint was raised and locked by browser
regression before this receipt was completed.

## Token and price audit receipt

- `token-normalization`, `token-contract`, and `all-provider-token-contract` prove
  non-overlapping recorded totals, source-total preservation, reasoning/cache
  semantics, and explicit unclassified data.
- `retail-pricing` proves Provider/domain-scoped aliases, effective dates, context
  tiers, Token-kind rates, partial coverage, sub-cent amounts, and fail-closed
  unknown models or ambiguous tiers.
- `retail-pricing-application` proves every derived amount retains its observation,
  model, price snapshot, and line items; line items reconcile to the stored amount.
- `retail-pricing-backfill` proves historical price selection, idempotent rebuild,
  restart safety, and no duplicate derived money.
- `cost-semantics-migration` proves actual, subscription, reported estimate, and
  retail equivalent remain distinct across migration and restart.
- `token-money-workbench` and `model-ranking` prove total/ranking conservation,
  separate classification/pricing coverage, isolated Provider/domain identity,
  and `unavailable` rather than false zero for unpriced data.
- V2 JSON/CSV export includes observation ids, models, observed time, precision,
  authority, per-observation Token totals, and complete immutable price-snapshot
  evidence without exporting sessions or secrets.

The runtime catalog is bundled and deterministic; it never scrapes vendor pricing
at runtime. Reviewed official sources and excluded pricing cases are recorded in
[`../research/official-pricing-sources-2026-08-28.md`](../research/official-pricing-sources-2026-08-28.md).

## Live local visual receipt

The V2 Dashboard was opened against the repository's isolated development Home.
No account identifier, credential, prompt, private usage amount, or model content is
recorded in this receipt.

| Surface                | Installed client                      | Read-only evidence rendered                                                                                                                                    | Result                                              |
| ---------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Codex                  | `codex-cli 0.150.1`                   | Official-account native quota buckets plus account token history and day precision                                                                             | passed                                              |
| Claude Code            | `2.1.248 (Claude Code)`               | Native `5 hour`, `Week · All models`, and `Week · Fable only` quota labels; no current local OTLP Token history                                                | quota passed; Token unavailable as designed         |
| OpenCode Go            | `1.18.23`                             | Official account quota plus this-Mac model/day Token history, reported estimate, and explicit coverage                                                         | passed with source-native coverage                  |
| Grok Build / SuperGrok | `grok 1.0.5`                          | Last successful official-client shared weekly quota remains visible while doctor reports the current connector stale; no current local telemetry Token history | degraded receipt passed; fresh live read unverified |
| Grok · xAI API         | dedicated Management key not provided | Separate tab presents contextual connection and keeps API Token/actual-cost/history unavailable                                                                | live unverified; isolation passed                   |

The same review confirmed system dark rendering, local official logos, native quota
labels, reset countdown plus absolute time, coverage/precision text, recovery actions,
and the two-column 1440px correction. Connector fixture and earlier opt-in receipts
are recorded in [`connector-receipts-2026-08-28.md`](connector-receipts-2026-08-28.md).

## Brand evidence

OpenAI Blossom, Claude, OpenCode light/dark, and xAI light/dark assets are bundled
under `static/brands/`. Their official sources, audited retrieval date, SHA-256,
theme selection, text fallback, and trademark constraints are recorded in
[`../../static/brands/README.md`](../../static/brands/README.md). Browser regression
also proves that rendering these marks makes no third-party network request.

## Known boundaries

- macOS is the only supported P0 platform; Windows and Linux packaging are out of scope.
- Grok Build quota and Claude Code quota adapters are experimental and fail closed on
  unknown versions or schema.
- Claude and Grok Token data requires explicit local telemetry setup before the
  corresponding agent process starts; absent telemetry remains unavailable.
- The current Grok Build connector was stale during the final live visual pass, so a
  fresh live value is not claimed even though the last successful official-client
  weekly quota remained visible.
- xAI API live account behavior is unverified because no dedicated Management key was supplied.
- The official retail catalog prices only evidence-complete supported models and
  tiers. Unknown model, Token kind, time tier, or context tier remains unpriced.
- Provider cost remains unknown when an official source does not expose it; unknown
  is never converted to zero.
- Recommendations are read-only and never switch agents.
- The P0 route remains a single Svelte composition root. Moving the Provider cards,
  workbench, and drawers into separate visual components is tracked as post-P0
  maintainability work; shared telemetry parsing and all domain/data seams are already
  outside the page, so this does not change runtime behavior or release evidence.
