# 02 — 下沉管理功能到设置抽屉

**What to build:** 用户通过页头设置入口访问连接管理、Monitoring、Diagnostics、Privacy、导出、保留策略和清理操作；首页正常状态不再被管理面板占据，异常提示能够直接定位到恢复位置。

**Blocked by:** 01 — 建立用量优先的 Provider 卡与官方品牌.

**Status:** implemented

- [x] Connections、Monitoring、完整 Diagnostics、Privacy、导出、retention 和 clear-data 控件进入一个设置抽屉。
- [x] 抽屉支持页头入口、关闭操作、焦点返回和直接聚焦指定 Connector 或 diagnostic 的深链接状态。
- [x] Provider degraded state 的恢复操作能打开对应设置项，而不是要求用户手动搜索。
- [x] 风险/推荐仅在低额度、预计耗尽、stale 或连接异常时显示紧凑提示；正常状态不保留大型占位区。
- [x] overview、settings、diagnostics 和 retention 使用独立错误边界；辅助请求失败不能替换已成功加载的用量。
- [x] 设置抽屉中的 destructive action 保留现有确认、范围和 credential ownership 边界。
- [x] CLI doctor、export、retention、clear 和 monitoring 行为不因界面移动而改变。
- [x] 浏览器测试覆盖设置开关、异常跳转、局部失败、导出和清理的可见行为。

**Verification:** `pnpm lint`, `pnpm check`, focused CLI/HTTP/monitoring/privacy Vitest coverage (15 tests), `pnpm build`, and all 11 Dashboard Playwright tests pass. Visual inspection covered both the usage-first home view and the scrolling settings drawer.
