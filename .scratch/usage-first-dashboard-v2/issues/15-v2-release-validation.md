# 15 — 完成 V2 发布验证

**What to build:** 维护者获得一个可复现的 Usage-first Dashboard V2 发布候选：数据语义、官方价格、官方 Logo、四个平台真实/降级行为、双语视觉和本地打包全部经过自动化与交互式验收。

**Blocked by:** 14 — 完成双语与无障碍交互.

**Status:** complete

- [x] Formatting、lint、typecheck、unit、integration、Connector contract、HTTP、CLI、security 和 production build 全部通过。
- [x] Browser suite 覆盖用量优先顺序、卡片内连接、设置抽屉、7 天默认、三时间窗口、币种、趋势、排行、详情、Grok 分域和 degraded states。
- [x] Package/install、默认启动、status、doctor、export、retention、clear 与 clean uninstall smoke 在全新临时 home 通过。
- [x] 使用当前本机可得的 Codex、Claude Code、OpenCode Go 和 Grok 数据完成只读视觉检查；无法 live 验证的维度明确标记 unverified。
- [x] 价格目录、历史 backfill、classification/pricing coverage、金额守恒和 unknown-not-zero 形成可审计验证收据。
- [x] 四个 Provider 官方 Logo 的来源、版本、light/dark 选择和 trademark 注意事项形成发布证据；无官方资产时确认纯文字 fallback。
- [x] README 与发布文档说明新首页、三类 Token 金额、固定订阅费边界、时间精度、价格 coverage、设置位置和恢复流程。
- [x] 独立 Standards/Spec review 无未解决问题，工作区无调试产物，最终提交可以从干净 checkout 重现全部验证。

## Verification

- `pnpm format:check`、`pnpm lint`、`pnpm check`、`pnpm build`：通过。
- `pnpm test`：33 个文件、125 项测试通过；`pnpm test:e2e`：14 项通过。
- `pnpm test:package`：临时安装、默认启动、status、doctor、JSON/CSV export、retention/compact、clear 和 clean uninstall 全部通过。
- 从 `41710fd` 开始的独立 Standards/Spec closure review 均为 zero unresolved findings；最后一项 legacy freshness 修复只在单 billing domain 时回填，多域证据保持 unavailable。
- 本机未提供 xAI Management key，xAI live account 行为保持 unverified；Grok 官方产品标识未通过审计下载，因此按规格使用纯文字 fallback，不使用 xAI corporate mark 替代。
