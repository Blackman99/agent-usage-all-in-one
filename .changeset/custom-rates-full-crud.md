---
'agent-usage-all-in-one': minor
---

Support full CRUD lifecycle and enhanced UX workflows for custom model rates.
Developers can now:

- View all configured custom model rates in the Settings drawer with auto-refresh on drawer open, an active rate count badge in the settings navigation bar, and a manual refresh button.
- Edit existing rates inline directly within the custom rate card view and update rates via `PUT /api/custom-rates/:id` or CLI `agent-usage rates set <model> --id <id>`.
- Retrieve individual custom model rate details via `GET /api/custom-rates/:id` and CLI `agent-usage rates get <id>`.
- Select target providers easily with a preset dropdown (Grok, DeepSeek dsh, Claude Code, Codex, OpenCode Go, OpenCode, Antigravity, or custom provider ID).
- One-click launch rate configuration directly from unpriced model detail panels in the Token & Model Costs view.
