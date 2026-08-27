# 07 — 接入 xAI API 计费域

**What to build:** xAI API 用户在 Grok provider 内的独立 billing domain 查看官方 token、实际费用、余额、spending limit 和历史，同时不会与 Grok Build 订阅数据相加。

**Blocked by:** 06 — 接入 Grok Build/SuperGrok.

**Status:** complete

- [x] onboarding 接受独立 Management key 并只保存 Keychain reference。
- [x] 官方 Management API 提供按模型和时间的 token、USD、balance、spending limit 与可得 invoice 数据。
- [x] actual cost 保留原币种、source id 和 official account authority。
- [x] Grok 卡片用明确的 billing-domain tabs 分隔 Build 与 xAI API。
- [x] 缺少 key、权限不足、rate limit、分页、部分历史和 unavailable balance 均有可靠降级。
- [x] contract fixtures、应用、CLI/HTTP 与浏览器测试证明两个 billing domain 不会合并或重复计数。
