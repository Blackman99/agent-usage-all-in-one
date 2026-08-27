# 08 — 提供统一历史与费用分析

**What to build:** 用户可以在四个平台之间一致地切换 24 小时、7 天和 30 天视图，查看 token 分类、模型/日期排行，以及严格分开的 actual、subscription 与 estimated cost 和可审计的 CNY 比较。

**Blocked by:** 03 — 接入 Codex 官方用量; 04 — 接入 OpenCode Go 用量; 05 — 接入 Claude Code 用量; 07 — 接入 xAI API 计费域.

**Status:** complete

- [x] 三个时间窗口使用 UTC half-open 查询并按当前本地时区正确展示。
- [x] input、output、cache-read、cache-write token 和 top models/days 可按 provider 与 billing domain 查询。
- [x] actual、subscription、estimated cost 永不混合，unknown 不显示为零。
- [x] estimate 关联 versioned price snapshot，换算关联带时间与来源的 exchange-rate snapshot。
- [x] 缺失或过期汇率只使 converted comparison 不可用，不隐藏原币金额。
- [x] 应用、数据库、HTTP、CLI 和浏览器测试覆盖边界时间、时区切换、价格版本和重复 observations。
