# Contributing

Thank you for improving Agent Usage. The project is local-first and handles
sensitive developer activity, so data authority, privacy, and non-overlapping
accounting are release requirements rather than optional polish.

## Development

Use macOS, Node.js 24+, and pnpm 10.33.3.

```bash
pnpm install
pnpm dev
```

Before opening a pull request, run:

```bash
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm test:e2e
```

Add a changeset for every user-visible change with `pnpm changeset`. Tests must
use synthetic fixtures and temporary homes; never commit transcripts, account
identifiers, tokens, cookies, API keys, or local database contents.

## Issues and pull requests

Use GitHub Issues for new public work. Historical specifications and tickets in
`.scratch/` keep their stable local identifiers. Describe the observed behavior,
expected behavior, reproduction, affected Provider/billing domain, and whether
the evidence is account-wide or this-Mac.

Pull requests should be narrowly scoped, link the issue, explain authority and
cost-purpose decisions, and include verification evidence. Provider trademarks
must follow the audited asset rules in `static/brands/README.md`.
