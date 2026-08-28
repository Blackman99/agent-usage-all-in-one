# 14 — 完成双语与无障碍交互

**What to build:** 中文和英文用户都能完整使用新版 Dashboard；键盘和屏幕阅读器用户可以操作 Provider cards、billing-domain tabs、时间/币种开关、图表、排行、settings 和详情 drawer，reduced-motion 用户不会遭遇不必要动画。

**Blocked by:** 13 — 完成系统深浅色与响应式视觉.

**Status:** ready-for-agent

- [ ] Simplified Chinese 与 English catalog 覆盖全部新摘要、费用、coverage、time precision、图表、排行、连接和设置文案，key 集合完全一致。
- [ ] Provider 官方名称与 billing-domain 原生标签按领域规则保留，不被错误翻译或合并。
- [ ] 所有按钮、tabs、drawer、filters、ranking rows 和恢复操作可通过键盘到达、触发并退出。
- [ ] Drawer 打开时具有正确名称和焦点约束，关闭后焦点回到触发元素；深链接打开后聚焦目标项。
- [ ] Progress bar 暴露当前百分比与原生标签；趋势图提供 selected window、series、gap 和 time precision 的文本替代。
- [ ] Focus indicator 在 light/dark 中清晰可见，颜色不是 quota status、coverage 或错误的唯一表达方式。
- [ ] Reduced-motion preference 禁用非必要进度和图表过渡，同时不影响 loading 或状态反馈。
- [ ] i18n、accessibility browser checks 和窄屏键盘流程全部通过，且无新增明显可访问性警告。
