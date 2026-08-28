# 01 — 建立用量优先的 Provider 卡与官方品牌

**What to build:** 用户打开 Dashboard 后首先看到紧凑页头和四张 Provider 用量卡；每张卡直接承载原生 quota、reset、连接状态和就地配置，并使用官方 Provider Logo。Grok 在一张 Provider 卡中继续以两个 billing-domain tabs 保持独立。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Dashboard 的主要 DOM 与视觉顺序是页头、Provider 用量卡、其余现有内容，用量不再排在管理区块之后。
- [ ] Provider 卡通过显式 connection target 映射关联 Connector 与可选 billing domain，不依赖 Connector id 与 Provider id 相同。
- [ ] 未连接卡在原用量位置显示权限说明和连接操作；已连接卡只保留低干扰状态与“管理连接”入口。
- [ ] connect、skip、retry 和 managed-secret 更新具有卡片级 loading，完成后同时反映最新连接、用量与诊断状态。
- [ ] Grok Build/SuperGrok 与 xAI API 使用同一卡片的独立 tabs，quota、Token、费用和余额不会跨域合计。
- [ ] Codex、Claude Code、OpenCode Go 与 Grok 使用本地打包的官方资产并保留原始比例；无法取得已审核官方资产时仅显示产品名称。
- [ ] 第一字母圆圈、第三方 Logo 聚合资源、远程运行时图片请求和自行描摹图标全部移除。
- [ ] 应用、HTTP 和浏览器测试覆盖已连接、未连接、跳过、失败、恢复及 Grok 分域行为。
