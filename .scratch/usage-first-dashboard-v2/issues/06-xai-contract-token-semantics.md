# 06 — 迁移 xAI API 并收缩旧 Token 契约

**What to build:** xAI API 用户能分辨账单/发票级 Token 与实时事件，所有 Provider 都迁移到新 Token 语义后，维护者可以安全删除旧兼容形式而不破坏历史、CLI 或导出。

**Blocked by:** 04 — 迁移 Codex 与 OpenCode Go Token 数据; 05 — 迁移 Claude Code 与 Grok Build Token 数据.

**Status:** ready-for-agent

- [ ] xAI API Token 保留官方账户 authority、模型和 billing-period/invoice time precision，不再冒充请求发生时间。
- [ ] 当前未开票或无精确事件的数据明确标记 coverage 缺口，不推导不存在的实时 Token。
- [ ] xAI API Token、actual cost、balance、spending limit 和 invoice 仍只归属 xAI API billing domain。
- [ ] 已有历史记录迁移到新语义后保持 idempotent，不因重启或 refresh 重复计数。
- [ ] 所有 production Connector 均不再依赖旧 Token 兼容形式，兼容读取/写入路径按 ADR 收缩。
- [ ] Overview、CLI、export、retention 与 compaction 在收缩后继续读取旧数据库升级结果。
- [ ] 全 Provider 集成测试验证 total reconciliation、authority、时间精度和 Grok billing-domain 隔离。
- [ ] 数据库从 V1 schema 直接升级并完成一次 restart round-trip，无数据丢失或重复。
