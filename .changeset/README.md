# Changesets

Every user-visible change must include a changeset created with `pnpm changeset`.
Choose patch, minor, or major according to semantic versioning and describe the
user-facing outcome. Merges to `main` update a release pull request; merging that
pull request publishes the package and creates the GitHub release.
