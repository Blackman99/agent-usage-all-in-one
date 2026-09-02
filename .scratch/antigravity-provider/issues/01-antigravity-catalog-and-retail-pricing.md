# 01 — 注册 Antigravity 目录定义与零售等效定价快照

**What to build:** 在 `src/connectors/catalog.ts` 中注册 `antigravity` ConnectorDefinition（声明 Provider `antigravity` 与 Billing Domain `code-assist-subscription`），并在 `src/core/retail-pricing.ts` 中添加 Antigravity 支持的官方及代理模型（Gemini 3.7 Flash/Pro、Gemini 3.6 Flash、Claude Sonnet 4.6、Claude Opus 4.6、GPT-OSS 120B 等）的公有云定价快照与归一化映射。

**Blocked by:** None.

**Status:** complete

- [x] 在 `src/connectors/catalog.ts` 中定义 `antigravity` ConnectorDefinition，包括 displayName、command (`agy`)、officialCredentialPaths (`.gemini/antigravity-cli`, `.gemini/antigravity`) 以及 expectedCoverage (`['tokens', 'history']`)。
- [x] 在 `src/core/retail-pricing.ts` 中注册 `antigravity` + `code-assist-subscription` 定价模型快照，确保对 Gemini 系列及 Claude Sonnet 等模型有确定的输入/输出/推理 Token 单价。
- [x] 确保未识别模型能安全回退至未分类状态，不破坏整体定价计算流水线。
- [x] 编写并运行单元测试 `tests/unit/core/retail-pricing.test.ts` 与 catalog 测试，验证价格解析准确性。

**Completion:** complete — Catalog definition and multi-model retail pricing snapshots added for Antigravity, unit tests passing.

