# 04 — 接入 Daemon Runtime 与端到端看板验证

**What to build:** 在 `src/server/runtime.ts` 中注册 `AntigravityConnector` 与对应策略配置；添加 Antigravity 品牌图标（`static/brands/antigravity.svg`）；完成 CLI（`agent-usage status`、`agent-usage doctor`、`agent-usage export`）与 Web Dashboard（总览卡片、Model Breakdown Treemap、模型排行、趋势图）的端到端数据联调验证。

**Blocked by:** 03 — 实现 Antigravity 连接器与客户端自动发现.

**Status:** complete

- [x] 在 `src/server/runtime.ts` 中实例化 `AntigravityConnector` 并注册到 connectors 列表与 connectorPolicies 中。
- [x] 在 `static/brands/` 提供 Antigravity 矢量图标及 UI 品牌色配置。
- [x] 确保 CLI status、doctor 与 export 命令完整支持 `antigravity` Provider。
- [x] 验证 Web Dashboard 正常展示 Antigravity 卡片、Token 趋势、模型分解树状图（Treemap）与 API Retail Equivalent 换算结果。
- [x] 运行全量测试套件（`pnpm test`、`pnpm check`、`pnpm lint`），确保代码格式与类型检查 100% 通过。

**Completion:** complete — Antigravity connector registered in daemon runtime, brand asset added, e2e integration tests verified, and all 49 test suites passing.

