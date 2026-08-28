# 12 — 提供模型排行与详情抽屉

**What to build:** 用户可以查看 selected window 的 Top 5 已知模型，默认按 recorded Token 排序并切换为 API retail equivalent；点击条目后审计 Provider、billing domain、Token 分类、价格 line items、coverage 与趋势。

**Blocked by:** 11 — 构建 Token 与金额工作台.

**Status:** implemented

- [x] Top 5 默认按 recorded Token 降序，支持切换到 retail-equivalent 排序并保持确定性的同值顺序。
- [x] 每行同时显示官方 Provider Logo、Provider/billing-domain 标签、模型、Token、可得金额和占比。
- [x] 不同 Provider 或 billing domain 的同名模型保持独立，不通过字符串名称跨来源合并。
- [x] 未知模型与 `all-models` Token 计入总量但位于独立“未分类用量”区域，不挤占 Top 5。
- [x] 未定价模型在 Token 排序中仍可见，金额显示 unavailable；金额排序不会将其伪装成零成本。
- [x] 模型详情展示 Token 分类、reported/derived total、金额 line items、价格来源/版本/生效时间、authority、time precision、observation time 和趋势。
- [x] 详情数值与工作台/Provider 明细可以守恒，关闭抽屉后焦点回到触发排行项。
- [x] 应用、HTTP 与浏览器测试覆盖排序、同名隔离、未分类、未知价格、详情证据和键盘开关。

## Verification

- `pnpm test`：33 个测试文件、118 项单元与集成测试通过。
- 重点模型排行/API 回归：2 个测试文件、8 项通过。
- `pnpm check`、`pnpm lint`、`pnpm format:check`、`pnpm build`：通过。
- `pnpm exec playwright test`：12 项 Dashboard 浏览器回归通过。
