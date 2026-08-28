# 06 — 迁移 xAI API 并收缩旧 Token 契约

**What to build:** xAI API 用户能分辨账单/发票级 Token 与实时事件，所有 Provider 都迁移到新 Token 语义后，维护者可以安全删除旧兼容形式而不破坏历史、CLI 或导出。

**Blocked by:** 04 — 迁移 Codex 与 OpenCode Go Token 数据; 05 — 迁移 Claude Code 与 Grok Build Token 数据.

**Status:** complete

- [x] xAI API Token 保留官方账户 authority、模型和 billing-period/invoice time precision，不再冒充请求发生时间。
- [x] 当前未开票或无精确事件的数据明确标记 coverage 缺口，不推导不存在的实时 Token。
- [x] xAI API Token、actual cost、balance、spending limit 和 invoice 仍只归属 xAI API billing domain。
- [x] 已有历史记录迁移到新语义后保持 idempotent，不因重启或 refresh 重复计数。
- [x] 所有 production Connector 均不再依赖旧 Token 兼容形式，兼容读取/写入路径按 ADR 收缩。
- [x] Overview、CLI、export、retention 与 compaction 在收缩后继续读取旧数据库升级结果。
- [x] 全 Provider 集成测试验证 total reconciliation、authority、时间精度和 Grok billing-domain 隔离。
- [x] 数据库从 V1 schema 直接升级并完成一次 restart round-trip，无数据丢失或重复。

**Verification:** `pnpm lint`, `pnpm check`, `pnpm format:check`, 18 focused Connector/normalization/application/migration/CLI/export/retention tests, `pnpm build`, and all 11 Dashboard Playwright tests pass. Repeat refresh and restart keep one xAI invoice observation; the 24-hour view reports no invoice Token while the 30-day view reports 1,742 categorized Tokens with billing-period/account-wide/delta evidence. A live xAI Management API call was not run because no dedicated management key is configured; the official response contract is covered with deterministic fixtures.
