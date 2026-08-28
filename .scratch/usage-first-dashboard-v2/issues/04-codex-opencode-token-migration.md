# 04 — 迁移 Codex 与 OpenCode Go Token 数据

**What to build:** Codex 与 OpenCode Go 用户在 Provider 卡和历史中看到符合新契约的 recorded Token：Codex 的粗粒度 `all-models` 数据进入未分类用量，OpenCode Go 的 reasoning/output 不再重复，并明确本机日级数据范围。

**Blocked by:** 03 — 扩展 Token 语义与时间精度契约.

**Status:** complete

- [x] Codex 只有账户总量时保留 recorded Token，并将模型与分类 coverage 标为未分类而不是伪造输入/输出。
- [x] Codex 日桶使用 day precision，24 小时视图不会把午夜时间戳描述为精确事件时刻。
- [x] OpenCode Go reasoning Token 不再同时隐藏于 output 并重复参与总量。
- [x] OpenCode Go 本机 session/day 数据保留 local-observation authority、Mac 范围和 day precision。
- [x] Provider 卡、history、CLI 和 export 对粗粒度与未分类数据给出一致说明。
- [x] 无法识别模型或 Token 类型的数据不产生 API retail equivalent，也不显示为零金额。
- [x] Connector contract、应用、迁移和浏览器测试覆盖真实粒度、重复采集和时间窗口边界。
- [x] Opt-in 本机 smoke 能确认两个平台仍可采集或给出准确 degraded state，且不读取新凭据。

**Verification:** `pnpm lint`, `pnpm check`, `pnpm format:check`, 24 focused Connector/application/migration/CLI/i18n tests, `pnpm build`, and all 11 Dashboard Playwright tests pass. Read-only live smoke passed against `codex-cli 0.150.1` and OpenCode `1.18.23`; only boolean contract/availability results were emitted, with no account, quota, or Token values.
