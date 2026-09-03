# Claude Fable 5.1 API pricing reviewed on 2026-09-03

Runtime pricing is fixed in the repository and does not scrape this page.

## Anthropic Claude transcript models

- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
  identifies the official API model id as `claude-fable-5-1`, with general
  availability beginning 2026-09-01.
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
  lists Fable 5.1 rates:
  - Base input: $10 / MTok
  - Output: $50 / MTok
  - Cache read (hits): $0.25 / MTok (75% cheaper than Fable 5's $1.00 / MTok)
  - 5-minute cache write: $12.50 / MTok (1.25x base input)
  - 1-hour cache write: $20.00 / MTok (2x base input)
    All values in USD.

## Effective interval

Available starting `2026-09-01T00:00:00.000Z`. Earlier observation timestamps stay
unpriced to reflect the release boundary.
