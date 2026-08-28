# 05 — 迁移 Claude Code 与 Grok Build Token 数据

**What to build:** Claude Code 与 Grok Build 用户通过 opt-in telemetry 获得符合新契约的模型、Token 分类和事件时间；未启用或不连续的 telemetry 显示缺失 coverage，而不是虚假的零和连续趋势。

**Blocked by:** 03 — 扩展 Token 语义与时间精度契约.

**Status:** complete

- [x] Claude Code observation 保留模型、input、output、cache-read、cache-write、authority 和实际可得的时间精度。
- [x] Claude reported cost 保留来源估算语义，并能在后续 cost migration 中关联对应模型或 observation。
- [x] Grok Build observation 保留模型、session、input、output、reasoning、cache-read 和 delta telemetry 语义。
- [x] 两个平台的 reasoning 与 output 根据官方来源定义参与总量，不发生双重计算。
- [x] telemetry 未启用、schema 不支持或时间区间断档时，Provider 卡和 history 显示不可用/缺口而不是零。
- [x] Grok Build Token 只归属 Build/SuperGrok billing domain，不能进入 xAI API domain。
- [x] OTLP/headless fixtures、HTTP ingestion、应用聚合和浏览器测试覆盖成功、partial、重复与 schema fail-closed。
- [x] Opt-in live receipt 更新为新契约字段，同时继续证明不会上传身份或 prompt 内容。

**Verification:** `pnpm lint`, `pnpm check`, `pnpm format:check`, 45 focused normalization/Connector/HTTP/migration/CLI/i18n tests, `pnpm build`, and all 11 Dashboard Playwright tests pass. Read-only live quota/billing smoke passed against Claude Code `2.1.248` and Grok `1.0.5`; no model call was made and only boolean/redacted outcomes were emitted.
