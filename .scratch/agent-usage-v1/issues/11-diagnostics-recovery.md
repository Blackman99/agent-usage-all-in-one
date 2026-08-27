# 11 — 提供跨 connector 诊断与恢复

**What to build:** 用户能从 Dashboard 和 `doctor` CLI 判断每个 provider 的 binary、capability、authentication、schema、freshness 和 recovery action，而不暴露账户标识或 secrets。

**Blocked by:** 03 — 接入 Codex 官方用量; 04 — 接入 OpenCode Go 用量; 05 — 接入 Claude Code 用量; 07 — 接入 xAI API 计费域.

**Status:** complete

- [x] doctor 对 daemon、database、四个 provider 和 Grok 两个 billing domain 给出一致诊断。
- [x] 错误分类至少区分 missing binary、not configured、unauthorized、unsupported、schema mismatch、rate limited、timeout 与 stale。
- [x] 每种 degraded state 显示最后成功时间、影响的 coverage 和可执行 recovery action。
- [x] provider card 不因失败消失，单 connector failure 不改变其他 connector 的健康状态。
- [x] 诊断输出、日志与错误对象经过统一 redaction，fake secrets 无法泄露。
- [x] 应用、CLI、HTTP、浏览器和安全测试覆盖组合故障与恢复后的状态转换。

**Completion:** complete — persisted connector/domain diagnostics, normalized categories, stale detection, redaction, provider isolation, recovery transitions, protected HTTP/CLI parity, and browser cards passed targeted integration, type, lint, build, and seven E2E checks on 2026-08-28.
