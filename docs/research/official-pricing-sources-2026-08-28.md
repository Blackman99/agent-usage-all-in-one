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
