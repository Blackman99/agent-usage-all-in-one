# Agent Usage — honest comparison axes

> Contrast on **categories**, not invented product names.  
> No dunking. Goal: help a reader decide when Agent Usage is (and isn’t) the right tool.  
> Facts from README.md / README.zh-CN.md.
>
> **Fact-check 2026-09-11:** Axes match README (macOS-first, local loopback, providers Codex/Claude Code/OpenCode/Grok/dsh/Antigravity, advice-only, API retail ≠ bill, Grok Build/SuperGrok vs xAI API never summed, Node ≥ 24). Named competitors in companion `named-competitors.md` (ccusage / CodeBurn / Token Monitor / TokenTracker / **tokscale ~5.4k**) after 开源对标 scan — P0: no Cursor yet, macOS only, don’t oversell all-in-one.

---

## Pitch reminder

**Agent Usage** = macOS-first, fully local multi-agent **usage center**. One command opens a dashboard for native quotas, reset times, tokens, model rankings, equivalent API cost, history, and diagnostics. Advice only — never auto-switches agents.

---

## Comparison matrix (categories)

| Axis                       | Checking each provider’s own UI    | Token / transcript exporters     | Generic cost / FinOps dashboards                              | **Agent Usage**                                                                       |
| -------------------------- | ---------------------------------- | -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Scope**                  | One provider at a time             | Often one tool’s logs or one API | Usually cloud APIs / invoices you wire in                     | Codex, Claude Code, OpenCode, Grok, dsh, Antigravity in one local view                |
| **Where data lives**       | Vendor account pages               | Export files you move around     | Often SaaS or shared warehouse                                | Fully local; loopback `127.0.0.1`; Application Support                                |
| **Native quotas**          | Authoritative for that vendor      | Usually absent or reconstructed  | Rarely matches “5h / weekly / All models / Fable-only” labels | Preserves each provider’s native quota windows & reset times                          |
| **Tokens & rankings**      | Per-product, fragmented            | Good for raw history             | Depends on ingestion                                          | 24h / 7d / 30d windows + model rankings + year usage wall                             |
| **Cost meaning**           | Mix of subscription UI + estimates | You compute offline              | Often “spend” from cards/invoices                             | **API retail equivalent** as separate evidence — not presented as the bill            |
| **Billing-domain honesty** | Per site                           | Easy to accidentally merge       | Easy to double-count                                          | Grok Build/SuperGrok vs xAI API **never summed**; unknown prices stay unpriced        |
| **Agent control**          | N/A                                | N/A                              | Sometimes “optimize / route” features                         | **Advice only** — never auto-switches agents                                          |
| **Credentials**            | Vendor login                       | Your export pipeline             | Often needs API keys in the cloud                             | Official-client creds stay in owning clients; optional xAI Management key in Keychain |
| **Platform**               | Web                                | Any                              | Any                                                           | **macOS + Node ≥ 24**                                                                 |

---

## When to prefer each category

### Checking each provider’s own UI

**Prefer when:** you only use one agent, need the absolute latest vendor-side account status, or must dispute a charge with that vendor.  
**Tradeoff:** tab fatigue; no cross-agent token rankings or unified local history.

### Token / transcript exporters

**Prefer when:** you want raw session dumps for research, custom notebooks, or offline audits you fully control.  
**Tradeoff:** you build the dashboard yourself; native quota windows and multi-billing-domain rules are easy to get wrong.

### Generic cost / FinOps dashboards

**Prefer when:** you already centralize cloud invoices, cards, and org-wide API spend across many services.  
**Tradeoff:** coding-agent **subscription quotas** and local CLI transcripts are usually second-class; retail-equivalent vs subscription vs estimate often collapse into one “cost” number.

### Agent Usage

**Prefer when:** you run **several** coding agents on a Mac and want one **local** place for native quotas + tokens + honest equivalent-API evidence — without cloud sync and without auto-routing.  
**Tradeoff:** macOS-only; not a substitute for vendor billing disputes; equivalent API cost ≠ what you paid for a subscription.

---

## Explicit non-claims

- Not a replacement for official provider billing portals
- Not a cloud usage SaaS or team admin console
- Not an agent router / auto-switcher
- Not affiliated with any listed provider
- Does not invent prices for unknown models

---

## One-sentence contrast (for posts)

> Instead of hopping between each agent’s quota page, exporting transcripts, or stuffing everything into a generic cost dashboard, Agent Usage keeps multi-agent quotas, tokens, and API-equivalent evidence in one **local** macOS dashboard — and never auto-switches your agents.

## Named competitors (short)

See [named-competitors.md](named-competitors.md) for sourced rows. One-liners:

- vs **ccusage**: CLI reports vs our Dashboard + native quotas
- vs **CodeBurn**: multi-tool/multi-platform packaging vs our stricter cost semantics + default no telemetry
- vs **Token Monitor**: closest dashboard; they have Cursor/multi-machine/menu bar we don’t claim
- vs **TokenTracker**: CN distribution benchmark — learn reach, don’t copy claims
- vs **tokscale** (~5.4k★): token usage / scale peer — re-check positioning before posts

**External P0 boundaries:** no Cursor yet · macOS only · don’t oversell “all-in-one”.

_Update when provider coverage or competitor facts change._
