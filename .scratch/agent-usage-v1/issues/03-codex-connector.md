# 03 — 接入 Codex 官方用量

**What to build:** Codex 用户在 Dashboard 和 CLI 中看到官方账户 quota bucket、reset、可得 token 与 coverage；安装版本缺少能力或账户失效时，Codex 卡片保留并提供可执行的恢复说明。

**Blocked by:** 02 — 自动发现并安全连接 providers.

**Status:** complete

- [x] 通过官方 app-server 能力协商读取账户 rate limits 和 usage，不调用私有接口。
- [x] provider 原生 quota 标签、窗口、使用比例和 reset 时间按动态 bucket 保存并显示。
- [x] 可得 token 活动进入历史存储，并明确 official account data authority。
- [x] app-server 不存在、方法不支持、未登录、超时和 schema 变化均形成隔离的 degraded state。
- [x] Dashboard、CLI status 与 doctor 输出一致且不泄露账户或认证材料。
- [x] 使用官方协议的脱敏 fixtures 完成失败优先的 connector contract、应用与界面验证。

**Completion:** complete — official app-server contract tests, consent gating, safe degraded diagnostics, persistence migration, CLI/Dashboard parity, full build/test/E2E, and a redacted live read-only smoke test passed on 2026-08-28.
