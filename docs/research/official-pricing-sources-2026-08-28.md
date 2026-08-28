# Official pricing sources reviewed on 2026-08-28

Runtime pricing is fixed in the repository and does not scrape these pages.

## Anthropic Claude Fable 5 tracer

- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
  identifies the official API model id as `claude-fable-5`, lists general
  availability beginning 2026-06-09, and states $10 per million input Tokens and
  $50 per million output Tokens.
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
  lists Fable 5 base input at $10/MTok, 5-minute cache writes at $12.50/MTok,
  1-hour cache writes at $20/MTok, cache hits at $1/MTok, and output at
  $50/MTok. All values are USD.

The initial catalog uses the standard public API baseline. It prices input,
output, and cache-read Tokens. A Claude Code observation with cache-write Tokens
is not priced because local telemetry does not prove whether the 5-minute or
1-hour rate applies. Data-residency, batch, fast-mode, and partner-platform
modifiers are outside this tracer and must not be inferred.

## OpenCode Go

- [OpenCode Go documentation](https://dev.opencode.ai/docs/go/) lists the current
  Go model IDs, the `opencode-go/<model-id>` client form, and the per-million
  input, output, cached-read, and available cached-write rates used by the plan.
  It also defines DeepSeek V4 peak hours as 01:00–04:00 and 06:00–10:00 UTC on
  weekdays, with all other times off-peak.
- [OpenCode session cost implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/session.ts)
  keeps reasoning separate from visible output and applies the selected model's
  output rate to reasoning Tokens.
- [OpenCode message history implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts)
  hydrates each stored message from its local database row. Assistant message
  data retains provider/model attribution, request time, categorized Tokens,
  and the client-reported cost used by the read-only local import.
- Every supported OpenCode Go model is tied to a reviewed repository commit,
  never the date this research was retrieved. The pinned history includes the
  [base table and Kimi K3](https://github.com/anomalyco/opencode/blob/51213520f5f69ce2c6c741adcb2785e017488ade/packages/web/src/content/docs/go.mdx),
  [MiMo V2.5 Pro](https://github.com/anomalyco/opencode/blob/be08207a88f3ae208b782832dc071863375cf734/packages/web/src/content/docs/go.mdx),
  [Hy3](https://github.com/anomalyco/opencode/blob/411eff73f026d4950c07947c4d983788cb615baa/packages/web/src/content/docs/go.mdx),
  [GPT 5.6 Luna](https://github.com/anomalyco/opencode/blob/da59457ca4ff55aca0147d4ddb33c495dc72be31/packages/web/src/content/docs/go.mdx),
  [Qwen3.8 Max](https://github.com/anomalyco/opencode/blob/e9e747245681127c9f3e300aa8c46f2554fdb294/packages/web/src/content/docs/go.mdx),
  [GLM 5.3](https://github.com/anomalyco/opencode/blob/e23586af2623f1bc2e8e6965d2d7acf7bd03d5c3/packages/web/src/content/docs/go.mdx),
  [DeepSeek V4](https://github.com/anomalyco/opencode/blob/a0f8dccbfe139ffc7137d1eaf6fee6e4195af599/packages/web/src/content/docs/go.mdx),
  [Muse Spark](https://github.com/anomalyco/opencode/blob/e2505d434a6d78904ecfe546c4a1980d26bd8cd1/packages/web/src/content/docs/go.mdx),
  [DeepSeek Vision](https://github.com/anomalyco/opencode/blob/813e6f3cec1bfb2cec4f50ca6cb19e225e747e95/packages/web/src/content/docs/go.mdx),
  [LongCat](https://github.com/anomalyco/opencode/blob/6bb772215b08b4b7d9243c27286950d85b9f678d/packages/web/src/content/docs/go.mdx),
  [Grok 4.6](https://github.com/anomalyco/opencode/blob/ac1c048e6420eb4c728fd3e343a1ba7b076cba92/packages/web/src/content/docs/go.mdx),
  and [GLM 5.3 Flash](https://github.com/anomalyco/opencode/blob/830aaf2059e87eab3105dda4c19556206d60c443/packages/web/src/content/docs/go.mdx).

The catalog records all fixed-price models in that reviewed table. Models with
request-length tiers require event-level evidence. DeepSeek peak/off-peak rates
require exact event time. The connector asks the official CLI for the database
path, opens it read-only, reads only completed assistant-message rows, hashes
source message identifiers before they leave the adapter, and imports each
request as an event-level delta. A successful import atomically reconciles
disappeared requests and removes legacy model/day aggregates; a failed import
leaves cached history intact. Missing source cost omits the reported estimate,
while a missing required Token field fails closed. Separate reasoning Tokens use
the output rate, matching OpenCode's published cost calculation behavior.
Missing cache-write rates remain unknown.

## xAI API and Grok Build

- [Grok 4.6 model page](https://docs.x.ai/developers/models/grok-4.6) identifies
  `grok-4.6` and its $2 input, $0.50 cached-input, and $6 output short-context
  rates per million Tokens.
- [xAI release notes](https://docs.x.ai/developers/release-notes) record Grok 4.6
  availability on 2026-08-12 and the doubled rates above 200K prompt Tokens.
- [Grok Build 0.1 model page](https://docs.x.ai/developers/models/grok-build-0.1)
  identifies the canonical slug and official `grok-code-fast*` aliases.
- [xAI pricing](https://docs.x.ai/developers/pricing) lists Grok Build 0.1 at
  $1 input, $0.20 cached-input, and $2 output per million Tokens through 200K
  prompt Tokens, with doubled long-context rates.

Reasoning is already included in output for the supported Grok observations and
is not billed twice. Event-level delta observations can select a context tier
from input plus cached-input Tokens. Account invoice/billing-period aggregates
and other coarse observations cannot prove a per-request context tier and remain
unpriced. The same model name is still resolved separately inside the
Build/SuperGrok subscription and xAI API billing domains.
