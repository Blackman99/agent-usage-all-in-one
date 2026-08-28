# 08 — 贯通 API 等价零售价 tracer

**What to build:** 用户首次看到一条可审计的模型 Token 到 API retail equivalent 的完整路径：使用 observation 时间生效的官方价格，生成幂等模型级金额，并在 Provider 卡和全局摘要展示价格与 coverage 证据。

**Blocked by:** 07 — 提供可信的 7 天全局摘要.

**Status:** complete

- [x] Domain Context 与新 ADR 定义 API retail equivalent、reported estimate、price snapshot、pricing coverage 和历史派生不变量。
- [x] 版本化官方价格目录至少包含一个已支持 Provider 的代表模型、模型别名、币种、生效区间、上下文档位和 Token-kind 单价。
- [x] Eligible usage observation 产生模型级 retail-equivalent record 与可审计 line items，金额精确对账到 input/output/reasoning/cache 贡献。
- [x] 派生使用 observation 时间点生效的价格版本，而不是无条件使用当前价格。
- [x] 相同 observation 和 price version 重复刷新、重启或 backfill 不会生成重复金额。
- [x] 未知模型、缺失 Token 类型、模糊上下文档位或未知价格返回 unavailable，不产生零或平均价格估算。
- [x] Provider 卡与全局摘要显示 USD 原值、价格版本、authority 和 pricing coverage。
- [x] 固定目录、历史边界、未知路径、应用/HTTP 和浏览器测试证明 tracer 从采集到显示完整可用。

**Verification:** `pnpm lint`, `pnpm check`, `pnpm format:check`, 28 focused pricing/application/history/HTTP/CLI/i18n tests, `pnpm build`, and all 11 Dashboard Playwright tests pass. The checked-in Anthropic Fable 5 price snapshot is backed by official pricing and model-lifecycle sources; no runtime price scraping is used.
