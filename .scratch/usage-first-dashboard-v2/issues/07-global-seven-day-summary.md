# 07 — 提供可信的 7 天全局摘要

**What to build:** 用户打开新版首页后默认看到 7 天 recorded Token、暂可得的 API retail equivalent、最紧张 quota bucket、数据时间和分类 coverage；时间选择被本地记住，未知或粗粒度数据保持清晰可见。

**Blocked by:** 01 — 建立用量优先的 Provider 卡与官方品牌; 06 — 迁移 xAI API 并收缩旧 Token 契约.

**Status:** ready-for-agent

- [ ] 首次打开默认查询 7 天；24 小时、7 天和 30 天切换后，本地记住最后选择且不进入 export。
- [ ] 紧凑摘要显示 selected-window recorded Token、API retail equivalent/不可估算状态、most constrained quota 和最新数据时间。
- [ ] Recorded Token 包含已知模型与未分类用量，且能从 Provider/billing-domain 明细守恒回总量。
- [ ] 分类 coverage 只描述 Token 分类完整度，不替代 quota/tokens/actual-cost/history 的独立 Coverage 状态。
- [ ] 粗粒度数据在摘要证据中保留 time precision；没有观测的时间范围不被解释为零使用。
- [ ] Provider-native quota bucket 不随分析窗口变化，reset 文案同时包含倒计时与本地绝对时间。
- [ ] Grok Build/SuperGrok 与 xAI API 贡献保持独立标识，禁止生成合并的 Grok 总额。
- [ ] 应用、HTTP、CLI 摘要和浏览器测试覆盖窗口持久化、未知金额、分类 coverage 与时间边界。
