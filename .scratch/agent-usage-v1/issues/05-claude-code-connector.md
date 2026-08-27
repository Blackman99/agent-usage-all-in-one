# 05 — 接入 Claude Code 用量

**What to build:** Claude Code 用户能通过 opt-in telemetry 查看 token，通过显式授权的官方客户端 adapter 查看动态 quota bucket；任一路径失效时另一条仍可独立工作并明确 coverage。

**Blocked by:** 02 — 自动发现并安全连接 providers.

**Status:** complete

- [x] 本地 OTLP ingestion 接收并归一化 input、output、cache-read 与 cache-write token。
- [x] quota adapter 仅调用官方客户端能力，动态保留 All models、Sonnet、Fable 或未来标签。
- [x] adapter 进行版本/schema 探测，未知输出 fail closed 并标记 experimental official-client authority。
- [x] 不提取、复制或回显 Claude OAuth credential。
- [x] telemetry 未启用、客户端未登录、quota 不可读和 cost 缺失均展示准确 degraded state，未知 cost 不为零。
- [x] contract fixtures、OTLP ingestion、应用、CLI/HTTP 与浏览器测试覆盖两条路径的独立成功和失败。

**Completion note:** 2026-08-28 已完成官方 screen-reader `/usage` 动态标签解析、带 daemon bearer token 的 OTLP ingestion、显式 consent、安全降级及 CLI/HTTP/Dashboard 一致性；format、lint、typecheck、build、34 个 Vitest 与 5 个 Playwright 测试全部通过，并在 API Usage Billing 账户上验证无订阅 quota 时准确降级。
