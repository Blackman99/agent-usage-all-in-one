# Domain Documentation Convention

- `CONTEXT.md` is the single root source for product boundaries, ubiquitous
  language, and invariants.
- `docs/adr/` contains durable architectural decisions, one Markdown file per
  decision.
- Specifications and tickets must use the terms defined in `CONTEXT.md`.
- Update `CONTEXT.md` when a domain term or invariant changes.
- Add an ADR when a technical choice has meaningful alternatives or long-lived
  consequences. Do not hide architectural decisions only inside tickets.
