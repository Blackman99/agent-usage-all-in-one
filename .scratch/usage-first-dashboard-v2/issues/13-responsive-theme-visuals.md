# 13 — 完成系统深浅色与响应式视觉

**What to build:** 用户获得一个中性、紧凑、数据优先的桌面 Dashboard：跟随系统深浅色，正常窗口两列、足够宽时最多四列、窄屏单列；额度、Logo、图表和数值在各尺寸保持清晰。

**Blocked by:** 02 — 下沉管理功能到设置抽屉; 12 — 提供模型排行与详情抽屉.

**Status:** implemented

- [x] 页面跟随系统 light/dark appearance，使用中性表面和高可读对比度，不依赖固定 dark-only 配色。
- [x] Provider 卡使用具有实际最小宽度的响应式网格：常规桌面两列、空间充足时最多四列、窄屏单列且无水平滚动。
- [x] Quota 使用水平 progress bar、百分比、状态色、倒计时和绝对 reset time，不使用装饰性环形仪表。
- [x] 官方 Logo 自动选择已审核的 light/dark 变体、保持比例且不着色；获取失败时纯文字 fallback 可用。
- [x] 页面不再出现首字母头像、大面积 Provider 品牌底色、装饰性渐变或过度阴影。
- [x] 首页数字使用紧凑 K/M 格式并提供完整 accessible value；详情显示精确整数和不丢失的 sub-cent amount。
- [x] Summary、Provider、workbench、ranking、settings 和 drawer 在代表性宽度与两种主题完成交互式视觉检查。
- [x] 浏览器回归证明所有用量/连接行为在视觉重构后保持可用，官方资产不会触发外部网络请求。

## Verification

- `pnpm test`：33 个测试文件、118 项单元与集成测试通过。
- `pnpm check`、`pnpm lint`、`pnpm format:check`、`pnpm build`：通过。
- `pnpm exec playwright test`：13 项 Dashboard 浏览器回归通过；专门覆盖 390/1280/1680 宽度、light/dark、实际主题资产选择、紧凑/完整数值与零外部请求。
- 浏览器交互式目检：light 1280 双列、dark 1680 四列、light 390 单列，以及 390 设置抽屉均通过；浅色风险横幅对比度在目检中修正后复验通过。
- `rg` 静态检查确认页面无 `radial-gradient`/`linear-gradient`，运行时品牌资产全部来自 `/brands/`。
