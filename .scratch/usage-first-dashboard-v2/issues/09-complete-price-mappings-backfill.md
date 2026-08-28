# 09 — 补全 Provider 定价映射与历史回算

**What to build:** 用户对能够可靠识别的 Claude Code、OpenCode Go、Grok Build 和 xAI API 模型获得完整的官方 API retail equivalent；已有历史按当时生效价格回算，无法可靠定价的 Codex 或未知模型继续显示 coverage 缺口。

**Blocked by:** 08 — 贯通 API 等价零售价 tracer.

**Status:** complete

- [x] 目录覆盖当前受支持且可从 observation 可靠识别的模型，价格只来自官方 Provider 资料并记录来源证据。
- [x] 模型别名按 Provider 与 billing domain 解析，同名模型不会跨 Provider 自动合并。
- [x] 上下文档位、输入、输出、reasoning、cache-read 和 cache-write 价格只在官方规则明确时使用。
- [x] Retained history 使用每条 observation 时间点的有效价格幂等回算；价格更新不会悄悄改写已记录快照。
- [x] Codex `all-models`、未知模型、未知 Token 类型和模糊价格 tier 计入 Token，但不计入金额。
- [x] Pricing coverage 的分子与分母可从 eligible/unpriced Token 明细重算，且不会被描述为整体 Coverage 分数。
- [x] Grok Build/SuperGrok 与 xAI API 使用各自模型、价格和金额归属，任何层级都不合并。
- [x] 官方价格 fixture、有效期边界、别名冲突、历史 backfill、重启和页面 coverage 测试全部通过。

**Verification:** `pnpm lint`, `pnpm check`, `pnpm format:check`, 60 focused pricing/backfill/Connector/application/HTTP/CLI/export/i18n tests, `pnpm build`, and all 11 Dashboard Playwright tests pass. Official source evidence is checked in for Anthropic, OpenCode Go, Grok Build 0.1, and Grok 4.6; coarse multi-tier observations remain explicitly unpriced.
