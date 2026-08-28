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

The catalog records all fixed-price models in that reviewed table. Models with
request-length tiers require event-level evidence. DeepSeek peak/off-peak rates
require exact event time; current local day aggregates therefore remain
unpriced. Separate reasoning Tokens use the output rate, matching OpenCode's
published cost calculation behavior. Missing cache-write rates remain unknown.

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
