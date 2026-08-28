# Open-source and attribution guide

Agent Usage is released under the MIT License. Source code, tests, documentation,
and the original Agent Usage logo/banner are covered by that license unless a
file or notice states otherwise.

## Adapted source

The local transcript parsing and reconciliation approach was adapted from T3
Code under MIT. Its copyright and license text are preserved in
`THIRD_PARTY_NOTICES.md`.

## Dependencies

`THIRD_PARTY_LICENSES.md` is generated from the exact pnpm lockfile and lists
every production and development dependency, version, declared license, and
project link. `BUNDLED_LICENSES.md` carries the complete license and copyright
texts for dependency code bundled into the browser distribution. Dependencies
installed separately retain their license texts in their own packages. Both
generated reports are checked by CI whenever dependencies change. The reviewed
bundle set is generated as `BUNDLED_DEPENDENCIES.json` directly from Vite's
client module graph, so a newly bundled npm package cannot bypass the full-text
license check by being omitted from a hand-maintained list.

## Provider marks

OpenAI, Claude, OpenCode, Grok, xAI, and their marks belong to their respective
owners. Bundled Provider marks identify integrations only and do not imply
endorsement. Their official sources, checksums, theme rules, and fallback policy
are documented in `static/brands/README.md`. The Agent Usage orbit-and-meter
mark is original and does not incorporate those Provider marks.

## Release provenance

Changesets controls semantic versions and changelogs. GitHub Actions runs the
quality gate and publishes with npm provenance. Release artifacts include the
MIT license, this dependency report, security policy, product brand assets, and
the project-level third-party notices.
