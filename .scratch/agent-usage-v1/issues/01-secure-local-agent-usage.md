# 01 — 启动安全的本地 Agent Usage

**What to build:** 用户执行一个命令即可启动仅监听 loopback 的本地 daemon，打开 Dashboard，并能从 CLI 读取同一份模拟 provider 摘要；该 tracer slice 贯穿采集、持久化、应用服务、HTTP、UI 和测试。

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] 默认命令能确保 daemon 运行并打开 Dashboard，重复执行不会启动冲突实例。
- [x] Dashboard 和 CLI status 展示同一份持久化 provider、quota bucket、freshness 与 coverage 数据。
- [x] 本地 API 仅监听 loopback，并通过一次性启动令牌建立受保护的浏览器会话。
- [x] 重启后 SQLite 中的数据仍然可读，重复采集不会重复计数。
- [x] 建立 `UsageApplication` 最高层测试 seam、临时数据库集成测试、HTTP 测试、CLI smoke test 和浏览器 smoke test。
- [x] 中英文消息目录、格式化、lint、typecheck、test 与 production build 命令可用。

**Completion:** complete — verified by automated integration, CLI subprocess, build, and browser tests.
