# 03 — 实现 Antigravity 连接器与客户端自动发现

**What to build:** 实现 `AntigravityConnector` 并实现 `Connector` 接口契约。支持自动发现宿主机上的 Antigravity 安装状态（检查 `agy` 命令或 `.gemini/antigravity-cli` / `.gemini/antigravity` 目录），协调 `AntigravitySqliteUsageClient` 收集两处 roots 下的数据并执行跨目录会话 UUID 幂等去重；在配额层面诚实输出 `quota: []`，构造符合预期的 `ConnectorSnapshot` 与降级状态。

**Blocked by:** 02 — 实现 Antigravity SQLite 与 Protobuf 会话用量解析客户端.

**Status:** blocked

- [ ] 实现 `AntigravityConnector` 类，注入 `AntigravitySqliteUsageClient`。
- [ ] 实现 `discover()` 方法，探测 `agy` 可执行路径及 `.gemini` 本地状态目录。
- [ ] 实现 `collect()` 方法，调用客户端读取会话历史，组装 `ConnectorSnapshot`（`quota: []`，真实 tokens 与 history）。
- [ ] 当目录不存在或会话为空时，优雅返回健康的空快照；当解析遇到权限或损坏时，产出明确的 degraded 诊断信息，不泄露用户敏感文件路径。
- [ ] 编写 connector 单元测试与契约测试，覆盖正常采集、空数据、降级状态与跨目录去重逻辑。
