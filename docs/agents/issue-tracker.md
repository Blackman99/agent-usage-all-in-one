# Issue Tracker Convention

New public work uses GitHub Issues in `Blackman99/agent-usage-all-in-one`.
Historical local Markdown tickets remain the durable record for pre-publication
efforts:

- Each effort is stored under `.scratch/<effort-slug>/`.
- The effort specification is `.scratch/<effort-slug>/spec.md`.
- Implementation tickets are individual files under
  `.scratch/<effort-slug>/issues/`, numbered from `01` in dependency order.
- Ticket blockers refer to those stable numbers and titles.
- Specifications and tickets are repository artifacts and remain versioned.
- Do not combine multiple tickets into one file.

ADR 010 records the migration decision. Do not recreate historical tickets on
GitHub; cite their stable local identifiers when later work depends on them.
