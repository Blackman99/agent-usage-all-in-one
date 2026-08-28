# Provider brand assets

These SVGs are bundled locally so the dashboard never makes runtime logo requests.
The audited version is the exact provider-hosted artifact retrieved on 2026-08-28;
its SHA-256 makes future replacement reviewable.

| Provider surface | Local asset and SHA-256                                                                                                                                                             | Official source                                                                                                  | Theme selection                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Codex            | `openai.svg` — `5979341866925ebb8f663d457ddeda9a4dcaf7603da8a1b529ca948d71601c1d`                                                                                                   | `OpenAI-black-monoblossom.svg` from the official [OpenAI Design guidelines](https://openai.com/brand/) logo pack | One official monochrome asset in both themes; no runtime recoloring |
| Claude Code      | `claude.svg` — `3a808e859d6b8b1e81698ab2c85257e4c7eaa6834e926bb0a519c6d0b2eb7828`                                                                                                   | `ClaudeIcon-Square.svg` from the [Anthropic Newsroom](https://www.anthropic.com/news) press kit                  | One fixed-color square asset in both themes                         |
| OpenCode Go      | `opencode-light.svg` — `4e3c99fad0454b986101eec58843bc63481b1f6569db7779f8c0a49815bef9ad`; `opencode-dark.svg` — `dc77a89df840a7f1665ec6638a89af2a5246a16cd1eb48bb7fa0f326782139b0` | Current square variants from the official [OpenCode brand page](https://opencode.ai/brand)                       | `prefers-color-scheme` selects the reviewed light/dark pair         |
| Grok / xAI API   | `xai-light.svg` — `c833951db0c9a48bfc2cf3d61a09a6bb222bf8679bbe74bca55b7ac2041b6f76`; `xai-dark.svg` — `f7df5a4be4723b3d85962306dfd0c2076e6791f4aa2e7ff7165336d0701447b5`           | Inline variants served by the official [SpaceXAI Brand Guidelines](https://x.ai/legal/brand-guidelines)          | `prefers-color-scheme` selects the reviewed light/dark pair         |

`opencode.svg` is an earlier official dark asset retained only for compatibility
with already-built clients; new UI surfaces use the audited pair above. If any
image fails to load, the UI falls back to the plain Provider name and never
invents a letter avatar or imitation mark.

All marks identify their external Providers only. They are not the Agent Usage
product mark and must not imply sponsorship or endorsement. Assets must preserve
their aspect ratio and must not be traced, recolored, decorated, or incorporated
into this product's own branding. Review the linked trademark guidance before
shipping a replacement.

The downloadable xAI/Grok asset package returned HTTP 403 during the audited
retrieval, so the official page-hosted SVG variants were used without alteration.
