# Subscription plan prices reviewed on 2026-08-30

Preset plan prices are fixed in the repository and are not scraped at runtime.
Every preset is editable in Settings; these pages are the evidence for the
shipped defaults only.

## Claude

- [Claude plans and pricing](https://claude.com/pricing) states Pro at "$17"
  monthly with an annual subscription, or "$20 if billed monthly", and shows Max
  starting from $100 with 5x and 20x variants.
- [What is the Max plan?](https://support.claude.com/en/articles/11049741-what-is-the-max-plan)
  states "Max 5x: $100 per month" and "Max 20x: $200 per month".

The catalog ships Pro monthly ($20), Pro annual ($17 x 12 = $204 per year), Max
5x ($100/month), and Max 20x ($200/month).

## ChatGPT / Codex

- [ChatGPT pricing](https://chatgpt.com/pricing/) and
  [About ChatGPT Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)
  give Plus at $20/month and two Pro tiers, $100 (5x Plus usage) and $200 (20x).
- [ChatGPT Business pricing](https://openai.com/business/chatgpt-pricing/) gives
  $25 per seat per month on monthly billing, $20 per seat billed annually.

Both pages returned HTTP 403 to a direct read on 2026-08-30; the values above
come from the official pages as indexed on the same date. Confirm them against an
invoice before relying on the preset — the Settings override exists for this.

## OpenCode Go

- [OpenCode Go](https://opencode.ai/go) states "$10/month" with the option to
  "Top up credit if needed" and "Cancel any time".

## Grok

[x.ai/pricing](https://x.ai/pricing) returned HTTP 403 and
[docs.x.ai/grok/faq](https://docs.x.ai/grok/faq) names SuperGrok and SuperGrok
Heavy without stating their prices. Third-party summaries disagreed on the Heavy
price, so **no Grok preset ships**. Grok Build/SuperGrok subscribers enter their
own price in Settings, which is recorded as a user-entered plan price. Add a
preset here only when an official page states the amount.

## Billing periods

Providers do not report the subscriber's renewal date through any read-only
surface reviewed here, so the renewal date is declared by the person. It is
optional: without it the billing period stays unknown and only the rolling-window
reading is shown.

## Proration

A plan price is spread over the average length of its own billing period —
365.25/12 days for a monthly plan, 365.25 days for an annual one — so a 30-day
window is charged 30 days of plan cost, not a whole month. The result is a
read-time comparison denominator and is never stored as a cost record.
