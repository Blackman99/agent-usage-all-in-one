# Provider brand assets

Reviewed Provider SVGs are bundled locally so the dashboard never makes runtime
logo requests. A Provider without a reviewed product-specific mark uses plain text.

| Provider surface | Local asset and SHA-256                                                                                                                                                             | Official source                                                                                                                                                                                                                | Theme selection                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Codex            | `openai.svg` — `5979341866925ebb8f663d457ddeda9a4dcaf7603da8a1b529ca948d71601c1d`                                                                                                   | `OpenAI-black-monoblossom.svg` from the official [OpenAI Design guidelines](https://openai.com/brand/) logo pack                                                                                                               | One official monochrome asset in both themes; no runtime recoloring                   |
| Claude Code      | `claude.svg` — `3a808e859d6b8b1e81698ab2c85257e4c7eaa6834e926bb0a519c6d0b2eb7828`                                                                                                   | `ClaudeIcon-Square.svg` from the [Anthropic Newsroom](https://www.anthropic.com/news) press kit                                                                                                                                | One fixed-color square asset in both themes                                           |
| OpenCode Go      | `opencode-light.svg` — `4e3c99fad0454b986101eec58843bc63481b1f6569db7779f8c0a49815bef9ad`; `opencode-dark.svg` — `dc77a89df840a7f1665ec6638a89af2a5246a16cd1eb48bb7fa0f326782139b0` | Current square variants from the official [OpenCode brand page](https://opencode.ai/brand)                                                                                                                                     | `prefers-color-scheme` selects the reviewed light/dark pair                           |
| Grok / xAI API   | `grok-dark.svg` — `a127a7cd42b0450f7d3827a331b0730aab49fd99c3fe920d172475b9ffc83992`; `grok-light.svg` — `b20648e2f111d7fbc91f58b22d1e76e9885b68a163cb5a1010f7f11bf5840491`         | `Grok_Logomark_Dark.svg` and `Grok_Logomark_Light.svg` from the official [SpaceXAI brand package](https://data.x.ai/logos/xAI_Grok_Assets.zip), linked by the [SpaceXAI Brand Guidelines](https://x.ai/legal/brand-guidelines) | The official black mark is used on light surfaces and the white mark on dark surfaces |

| dsh (DeepSeek) | `deepseek.svg` — `a6a972765f694fe01a3cd9a563bce1bfcdb67d57e31d69ee0affd703a1c4f247` | `img/logo.svg` served by the official [DeepSeek API documentation](https://api-docs.deepseek.com/) | One official monochrome asset in both themes, shown on a light plate the way the OpenAI mark is; no runtime recoloring |

DeepSeek publishes no brand or press-kit page, so the audited asset is the mark
its own documentation site serves, byte-for-byte. It is a single dark path with
no light counterpart, so it keeps the light plate the OpenAI mark already uses
instead of being recolored for dark surfaces.

`opencode.svg` is an earlier official dark asset retained only for compatibility
with already-built clients; new UI surfaces use the audited pair above. If any
image fails to load, the UI falls back to the plain Provider name and never
invents a letter avatar or imitation mark.

All marks identify their external Providers only. They are not the Agent Usage
product mark and must not imply sponsorship or endorsement. Assets must preserve
their aspect ratio and must not be traced, recolored, decorated, or incorporated
into the Agent Usage orbit-and-meter logo. Compatibility surfaces such as Provider
cards and the dashboard shown in the README showcase may display the audited assets
only when each mark remains visually separated and names its Provider. The showcase
is a captured product surface; it must not substitute traced, recolored, or invented
Provider marks. Review the linked trademark guidance before shipping a replacement.

The official SpaceXAI download endpoint returned HTTP 403 during the audited
retrieval. The exact archive was therefore obtained from the public mirror attached
to [Simple Icons issue #13853](https://github.com/simple-icons/simple-icons/issues/13853),
whose report links the same official package. The audited ZIP SHA-256 is
`f41a93923a85047b4b5a9571b7ec73339f562c3e58acd096e25584ab0ae2a1fb`;
the two bundled SVGs preserve the supplied path geometry and fills unchanged.
