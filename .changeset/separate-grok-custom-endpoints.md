---
'agent-usage-all-in-one': patch
---

Separate Grok token statistics between official SpaceXAI models and custom endpoints.
Previously, all Grok session transcript activity was attributed to the `grok-build-subscription` domain ("Grok Build / SuperGrok shared pool"), polluting the subscription quota pool with tokens from custom model endpoints (such as Gemini, Kimi, local models, or proxy endpoints configured in `~/.grok/config.toml`).
Now:

- Official Grok models (`grok-4.6`, `grok-4.5`, `grok-build-0.1`, `grok-code-fast-1`, etc.) remain in `grok-build-subscription` with the official weekly subscription allowance.
- Custom endpoint models are attributed to a separate `custom` (Custom endpoints) billing domain (or the custom route if configured in `config.toml`).
- Custom endpoint domains are included in workbench and global headline totals with full token and retail-equivalent share tracking, matching the multi-domain design of `dsh`.
