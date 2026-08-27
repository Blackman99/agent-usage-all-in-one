# 06 — 接入 Grok Build/SuperGrok

**What to build:** Grok 用户获得一张顶级 provider 卡片，其中 Grok Build/SuperGrok billing domain 展示本地 token、可得共享周额度、reset、订阅 coverage 和实验性来源状态。

**Blocked by:** 02 — 自动发现并安全连接 providers.

**Status:** complete

- [x] Grok Build headless/OTel observations 归一化为 model/session token，支持缺失 cost。
- [x] 显式授权的官方客户端 billing capability 经过版本探测后读取订阅 usage，不复用 OAuth token。
- [x] 共享周额度按 provider 原生标签展示，不虚构五小时 bucket。
- [x] billing capability 不可用时保留本地历史，并提供官方 `/usage` 恢复入口。
- [x] Grok Build 数据归属于独立 billing domain，不能与未来 xAI API 数据合并。
- [x] contract、应用、CLI/HTTP 与浏览器测试覆盖成功、partial、alpha telemetry 和 schema 失配。

**Completion note:** 2026-08-28 已完成官方 `grok agent stdio` / `x.ai/billing` ACP adapter、v1 alpha OTLP protobuf 与 headless JSON 归一化、独立 `grok-build-subscription` billing domain、reasoning token、delta/schema fail-closed 及 `/usage` 恢复入口。build、42 个 Vitest 和 6 个 Playwright 测试全部通过；本机无 `grok` 可执行文件，真实客户端调用标记为 fixture-verified，protobuf HTTP ingestion 已端到端验证。
