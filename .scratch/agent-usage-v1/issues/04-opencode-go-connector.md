# 04 — 接入 OpenCode Go 用量

**What to build:** OpenCode Go 用户看到官方滚动五小时、周、月额度和 reset，以及本机 OpenCode session 的 token 与成本历史；账户级与本机范围始终清晰区分。

**Blocked by:** 02 — 自动发现并安全连接 providers.

**Status:** complete

- [x] 经用户同意后原位使用 OpenCode Go key 调用官方 account-wide usage endpoint。
- [x] 五小时、周、月 bucket 的比例、reset 和 use-balance 状态按 official account authority 展示。
- [x] 本地官方 CLI/export 数据形成 model/day token 与 cost observations，并标记 local observation。
- [x] 由额度上限乘百分比得到的金额明确标记 estimate，绝不作为 actual cost。
- [x] 缺少订阅、认证失败、endpoint 不支持、CLI 版本漂移和本地历史缺失均有降级与修复入口。
- [x] fixtures、应用集成、HTTP/CLI 和浏览器测试验证数据范围、幂等与错误隔离。

**Completion:** complete — official account endpoint, in-place auth, 90-day local model/day aggregation through the official CLI, truthful scope/estimate labeling, safe degradation, full build/test/E2E, and a redacted live read-only smoke test passed on 2026-08-28. The official endpoint does not expose the Use balance setting, so it is explicitly reported as unknown.
