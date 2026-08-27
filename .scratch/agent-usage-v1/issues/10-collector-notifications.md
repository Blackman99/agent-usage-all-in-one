# 10 — 持续采集并发送本机通知

**What to build:** 用户可选择五分钟后台 collection 和开机启动，并收到去重的低额度、预计耗尽、reset 与 connector failure 本机通知；所有 provider 遵守自己的频率和退避。

**Blocked by:** 09 — 预测额度并给出透明建议.

**Status:** complete

- [x] Dashboard 打开、手动操作和 scheduler 均通过同一 refresh use case，重叠运行被合并。
- [x] connector minimum interval、timeout 与 exponential backoff 被持久化并正确恢复。
- [x] 用户可显式启用或禁用 macOS user-scoped start-at-login，默认关闭。
- [x] 20%、5%、预计耗尽、reset 和 prolonged failure 通知按状态转换发送。
- [x] 相同事件在连续轮询中不重复，恢复后再次跨阈值可以重新通知。
- [x] fake clock/notifier、daemon restart、CLI/HTTP 与浏览器测试覆盖调度、退避、开机启动和去重。
