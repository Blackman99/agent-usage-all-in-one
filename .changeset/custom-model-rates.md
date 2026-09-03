---
'agent-usage-all-in-one': minor
---

Support user-configured custom model rates for custom endpoints and routes.
When using custom routes, proxy endpoints, or third-party models in dsh (DeepSeek
Harness) or other providers, session tokens are recorded locally but previously
remained unpriced because the built-in retail catalog only covers known official
models under fixed billing domains.

Developers can now configure per-model input, output, and cache-read rates per
million tokens (in USD) either wildcarded across all routes or qualified by
billing domain. Custom rates take precedence over default catalog entries, and
saving, updating, or deleting custom rates automatically triggers background
re-pricing to backfill previously unpriced historical sessions. Rates can be
managed via the Settings drawer in the dashboard, the HTTP API (`/api/custom-rates`),
or the CLI (`agent-usage rates list / set / delete`).
