# 13 — 完成 P0 打包与发布验收

**What to build:** 维护者获得一个可在 macOS 本地安装和运行的 P0 artifact、完整中英文体验、全量自动化结果、四个平台真实或脱敏 connector receipts，以及说明已知降级边界的使用文档。

**Blocked by:** 10 — 持续采集并发送本机通知; 11 — 提供跨 connector 诊断与恢复; 12 — 完成隐私控制、导出与保留策略.

**Status:** complete

- [x] production build、package/install、default open、status、doctor 与 clean uninstall smoke tests 在全新临时 home 通过。
- [x] 中英文 catalog 无缺失 key，provider-owned labels 保持原文，关键页面完成视觉与可访问性检查。
- [x] formatting、lint、typecheck、unit、integration、contract、HTTP、CLI、browser 与 security 全量套件通过。
- [x] Codex、Claude Code、OpenCode Go、Grok Build 和 xAI API 各有 opt-in live check 或脱敏真实 receipt；无法实测项明确标记 unverified 及原因。
- [x] README 说明安装、隐私、权限、数据等级、provider coverage、实验性 connector、故障恢复和删除流程。
- [x] 最终代码审查无未解决的标准或规格问题，当前分支形成可复现提交。

**Completion:** complete — the macOS package smoke, complete bilingual catalog, 65 automated unit/integration/contract/HTTP/CLI/security checks, nine browser scenarios, redacted connector receipts, and independent Standards/Spec reviews passed on 2026-08-28.
