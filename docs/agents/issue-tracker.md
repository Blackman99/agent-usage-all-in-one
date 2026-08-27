# Issue Tracker Convention

This repository uses local Markdown as its issue tracker because it has no
configured remote tracker.

- Each effort is stored under `.scratch/<effort-slug>/`.
- The effort specification is `.scratch/<effort-slug>/spec.md`.
- Implementation tickets are individual files under
  `.scratch/<effort-slug>/issues/`, numbered from `01` in dependency order.
- Ticket blockers refer to those stable numbers and titles.
- Specifications and tickets are repository artifacts and remain versioned.
- Do not combine multiple tickets into one file.

If a remote tracker is configured later, record an explicit migration decision
before publishing new work there. Existing local ticket identifiers remain
stable historical references.
