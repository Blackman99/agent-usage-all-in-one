# 11 — 构建 Token 与金额工作台

**What to build:** 用户在 Provider 卡之后看到第二大信息主体：actual cost、reported estimate、API retail equivalent 三项金额、CNY/USD 证据，以及可在 Token 与 retail equivalent 间切换的 Provider 堆叠趋势。

**Blocked by:** 07 — 提供可信的 7 天全局摘要; 09 — 补全 Provider 定价映射与历史回算; 10 — 严格分离四类费用语义.

**Status:** complete

- [x] 工作台将 recorded Token、actual、reported estimate 与 retail equivalent 分成清晰指标，不生成混合“总花费”。
- [x] Fixed subscription cost 位于 billing detail，不进入三项 Token 金额或趋势总计。
- [x] CNY 为默认显示，USD 原值作为次级证据并可切换；缺失/过期汇率只禁用 CNY。
- [x] 趋势可切换 recorded Token 与 retail equivalent，24 小时使用小时桶，7/30 天使用日桶。
- [x] 趋势按 Provider 堆叠并保留 billing-domain 归属，Grok 两个 domain 不生成合并值。
- [x] 没有 observation 的 interval 显示为 gap，day/billing-period precision 具有不同视觉和可访问说明。
- [x] 每个金额旁显示 authority、observation time、pricing/conversion evidence 与 coverage；正的 sub-cent amount 不显示为零。
- [x] 应用聚合、HTTP read model、图表文本替代、窗口/币种切换和浏览器交互测试覆盖完整工作台。

## Verification

- `pnpm test`：32 个测试文件、117 项单元与集成测试通过。
- 重点聚合/API 回归：5 个测试文件、14 项通过。
- `pnpm check`、`pnpm lint`、`pnpm format:check`、`pnpm build`：通过。
- `pnpm test:e2e`：11 项 Dashboard 浏览器回归通过。
