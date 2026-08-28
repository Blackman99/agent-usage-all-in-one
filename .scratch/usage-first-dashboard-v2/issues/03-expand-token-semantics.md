# 03 — 扩展 Token 语义与时间精度契约

**What to build:** 用户和后续分析功能获得一个能够区分来源总量、非重叠 Token 分类、未分类用量与时间精度的新 normalized contract；现有 Connector 和历史数据在扩展阶段继续可读，避免一次性破坏全部调用方。

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] Domain Context 增加 recorded Token、source-reported total、unclassified usage、Token semantics 与 time precision 的统一定义和不变量。
- [x] 新 ADR 记录 Token 单次计数、reasoning/cache 语义、时间精度以及 expand-contract 迁移选择。
- [x] Usage observation 能表达来源总量、分类字段、模型归属、总量推导方式和 event/hour/day/billing-period 时间精度。
- [x] 数据库迁移在已有 V1 数据上可重复执行、重启安全，并保留原 observation id、authority 和 observed time。
- [x] 扩展阶段继续接受旧 Connector snapshot，并为缺失的新字段提供诚实、非推测性的兼容解释。
- [x] Overview、history 和 export 可以返回新证据，同时旧 CLI 与当前 Dashboard 在迁移期间保持可用。
- [x] Token 总量测试证明一个 Token 最多计数一次，reasoning 是否包含于 output 由来源语义明确决定。
- [x] 迁移、应用和 HTTP 测试覆盖完整分类、只有总量、未知模型、日级数据与账单级数据。

**Verification:** `pnpm lint`, `pnpm check`, 20 focused unit/integration tests across normalization, migration, history, application, export, and HTTP, plus `pnpm build` pass. The migration was exercised twice against seeded V1 rows and preserved observation identity, authority, and observed time.
