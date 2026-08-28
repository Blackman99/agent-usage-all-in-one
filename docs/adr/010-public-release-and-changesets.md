# ADR 010: Public release through GitHub, Changesets, and npm

- Status: accepted
- Date: 2026-08-28

## Decision

The canonical public repository is `Blackman99/agent-usage-all-in-one`. GitHub
Issues becomes the tracker for new public work while historical `.scratch/`
ticket identifiers remain stable. Changesets owns semantic version proposals,
release pull requests, changelogs, npm publication, and GitHub releases.

CI runs on macOS with Node.js 24 because the supported P0 runtime and package
smoke exercise macOS-specific behavior. npm publication is public and records
GitHub Actions provenance. Secrets are stored only in GitHub/npm release
configuration and are never committed.

## Consequences

Every user-visible pull request needs a changeset. Merging a normal change
updates a release pull request; merging the release pull request publishes the
version. A failed quality gate or missing npm authorization blocks publication
without changing the registry.
