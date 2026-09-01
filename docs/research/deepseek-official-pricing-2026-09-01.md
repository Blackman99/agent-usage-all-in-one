# DeepSeek API pricing reviewed on 2026-09-01

Runtime pricing is fixed in the repository and does not scrape this page. These
rates back the `dsh` Provider's `deepseek-official` billing domain, which is
separate from the OpenCode Go entries for the same model ids.

## Source

- [DeepSeek API pricing](https://api-docs.deepseek.com/quick_start/pricing)
  lists the model ids `deepseek-v4-pro`, `deepseek-v4-flash`, and
  `deepseek-v4-flash-vision-exp`, each with a cache-hit input, cache-miss input,
  and output rate per million Tokens, and states that peak hours are
  01:00–04:00 and 06:00–10:00 UTC, Monday through Friday, with off-peak rates at
  half the peak level.

## Rates per million Tokens, USD

| Model                                     | Cache-hit input | Cache-miss input | Output |
| ----------------------------------------- | --------------- | ---------------- | ------ |
| `deepseek-v4-pro` (off-peak)              | 0.022           | 0.66             | 1.98   |
| `deepseek-v4-pro` (peak)                  | 0.044           | 1.32             | 3.96   |
| `deepseek-v4-flash` (off-peak)            | 0.007           | 0.22             | 0.66   |
| `deepseek-v4-flash` (peak)                | 0.014           | 0.44             | 1.32   |
| `deepseek-v4-flash-vision-exp` (off-peak) | 0.007           | 0.22             | 0.66   |
| `deepseek-v4-flash-vision-exp` (peak)     | 0.014           | 0.44             | 1.32   |

Cache-hit input is priced as the `cache-read` Token kind and cache-miss input as
`input`. The table bills no cache write, so the `cache-write` rate is absent
rather than zero, and cache-write Tokens — which dsh does not report for these
routes — would stay unpriced instead of being guessed.

## Effective interval

The published table carries no effective date beyond model version markers, and
the peak/off-peak structure was introduced for 2026-08-16 without a documented
switch instant inside that day. The catalog interval therefore opens at
`2026-08-17T00:00:00.000Z`: a request from before the first complete day stays
unpriced rather than being priced at rates that may not yet have applied to it.

## Why these entries are not shared with OpenCode Go

The OpenCode Go catalog lists the same three models at the same numbers today,
because Go passes DeepSeek's rates through. The two remain separate entries with
separate sources so a future reseller markup changes only the domain it belongs
to. Peak/off-peak selection requires event-level time, which dsh session logs
provide; a day or period aggregate would stay ambiguous and unpriced.
