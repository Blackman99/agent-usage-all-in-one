# OpenAI GPT-6 Astra pricing reviewed on 2026-09-05

Runtime pricing is fixed in the repository and does not scrape this page.

## OpenAI Codex transcript models

- [OpenAI GPT-6 Astra model page](https://developers.openai.com/api/docs/models/gpt-6-astra)
  identifies the official API model id as `gpt-6-astra`, with general
  availability beginning 2026-09-03.
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
  lists GPT-6 Astra rates:
  - Base input: $10 / MTok
  - Output: $50 / MTok
  - Cache read (hits): $1.00 / MTok (0.1x base input)
  - Cache write: $12.50 / MTok (1.25x base input)
  - Long context (>272K prompt tokens):
    - Input: $20 / MTok (2x base input)
    - Output: $75 / MTok (1.5x base output)
    - Cache read: $2.00 / MTok
    - Cache write: $25.00 / MTok
      All values in USD.

## Effective interval

Available starting `2026-09-03T00:00:00.000Z`. Earlier observation timestamps stay
unpriced to reflect the release boundary.
