# 09 — 预测额度并给出透明建议

**What to build:** 用户在首屏看到最紧张额度、预计能否撑到 reset 和建议使用的 agent，并能检查使用了哪些 freshness、burn rate 和 coverage 依据；系统绝不自动切换 agent。

**Blocked by:** 08 — 提供统一历史与费用分析.

**Status:** complete

- [x] burn-rate forecast 只在连续历史充分时产生，并返回窗口与 confidence。
- [x] 预测正确处理 reset 落在 horizon 内、多个 quota bucket、stale history 和断档。
- [x] recommendation 对低剩余额度、预计提前耗尽、stale/partial connector 做确定性排序。
- [x] Dashboard 与 CLI 显示相同建议和本地化理由，并可追溯输入来源。
- [x] recommendation 只读，不暴露任何自动切换或 agent 执行接口。
- [x] 确定性时钟测试覆盖不足历史、相同风险、过期数据和跨 billing-domain 隔离。
