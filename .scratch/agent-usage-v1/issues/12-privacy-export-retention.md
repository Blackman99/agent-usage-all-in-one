# 12 — 完成隐私控制、导出与保留策略

**What to build:** 用户可以导出脱敏 JSON/CSV、控制账号标识、检查 retention，并一键删除 usage history 与可选的产品 Keychain secrets；操作不影响官方客户端拥有的 credentials。

**Blocked by:** 02 — 自动发现并安全连接 providers; 08 — 提供统一历史与费用分析.

**Status:** complete

- [x] JSON/CSV 导出包含查询窗口、data authority、freshness、token 与独立 cost kinds。
- [x] 导出默认去除 account identifiers，且永不包含 secret value、cookie、OAuth token 或 secret reference。
- [x] raw observations 在 90 天后仅在成功生成 daily aggregates 后删除。
- [x] retention 和 compaction 在 daemon restart、时区变化与重复运行下保持幂等。
- [x] clear data 提供明确范围，Keychain 清理只删除产品创建的 entries。
- [x] 数据库、应用、CLI/HTTP、浏览器和注入 fake-secret 的安全测试全部通过。

**Completion:** complete — redacted JSON/CSV artifacts, explicit privacy metadata, transactional UTC daily compaction, restart-safe retention status, scoped data/Keychain clearing, protected HTTP and CLI commands, and browser download/clear flows passed targeted integration, build, and eight E2E checks on 2026-08-28.
