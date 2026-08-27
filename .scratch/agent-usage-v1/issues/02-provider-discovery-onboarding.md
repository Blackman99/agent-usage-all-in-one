# 02 — 自动发现并安全连接 providers

**What to build:** 用户首次打开产品时能看到 Codex、Claude Code、OpenCode Go 和 Grok 的发现与连接状态，逐项了解权限后 connect、skip、retry；需要的产品凭据进入 Keychain，已有官方凭据只在用户同意后原位引用。

**Blocked by:** 01 — 启动安全的本地 Agent Usage.

**Status:** complete

- [x] 自动发现四个平台的可执行程序、可用配置和连接能力，探测失败彼此隔离。
- [x] onboarding 支持 connect、skip、retry，并且任一 provider 失败不阻塞完成。
- [x] 每个 connector 显示请求权限、credential owner、实验性标记和预期 coverage。
- [x] 产品创建的 secret 只存 Keychain，数据库、日志、API 与界面不出现 secret value。
- [x] 现有 provider credential 只有在显式同意后使用且不被复制。
- [x] 应用服务、HTTP、CLI 与浏览器测试覆盖发现、授权、拒绝、缺失 Keychain 和重新连接。

**Completion:** complete — verified by application, adapter, HTTP, CLI subprocess, security, and browser tests.
