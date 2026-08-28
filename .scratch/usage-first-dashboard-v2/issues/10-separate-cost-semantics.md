# 10 — 严格分离四类费用语义

**What to build:** 用户在 Dashboard、CLI 和 export 中清楚区分 actual billed cost、fixed subscription cost、Provider/client reported estimate 与 API retail equivalent；历史 generic estimate 被安全迁移，重叠 quota-window 金额不再污染时间范围总计。

**Blocked by:** 08 — 贯通 API 等价零售价 tracer.

**Status:** ready-for-agent

- [ ] Cost contract 显式表达 actual、subscription、reported-estimate 与 retail-equivalent 四种互斥 purpose。
- [ ] 旧 generic estimate 通过 expand-contract 迁移到可证明的 reported-estimate 或 retail-equivalent；无法证明的记录保留未知证据而不猜测。
- [ ] OpenCode Go 的五小时、周、月 allowance 等价值留在 quota context，不作为三个重叠时间范围费用相加。
- [ ] Claude/client reported cost、OpenCode 本地 session cost 与 xAI actual account cost 保留各自 authority、model/source 和 observed time。
- [ ] 固定订阅费继续可见但不分摊到 Token、模型、session 或日期。
- [ ] Overview、CLI 和 export 分别输出四类金额；未知 amount 为 null/unavailable，不格式化为零。
- [ ] USD/native amount 精确保留，CNY 仅在有效汇率存在时生成；stale/missing rate 不隐藏原币证据。
- [ ] Migration、金额守恒、重叠来源、汇率、API/CLI/export 与浏览器回归测试全部通过。
