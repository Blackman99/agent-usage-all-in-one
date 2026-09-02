# 02 — 实现 Antigravity SQLite 与 Protobuf 会话用量解析客户端

**What to build:** 实现 `AntigravitySqliteUsageClient`，支持扫描 `~/.gemini/antigravity-cli` 与 `~/.gemini/antigravity` 下的 `conversations/*.db`。通过 `protobufjs` 解析 `gen_metadata.data` 中的官方生成元数据（Prompt Tokens、Completion/Candidate Tokens、Model ID、时间戳、耗时），依照 `normalizeTokenObservation` 转换并生成标准四元组 `UsageObservation` 与 `CostRecord`。实现基于 `conversation_summaries.db` 与文件 `mtime` 的两级增量持久化缓存。

**Blocked by:** 01 — 注册 Antigravity 目录定义与零售等效定价快照.

**Status:** blocked

- [ ] 实现 `AntigravitySqliteUsageClientOptions` 与 `AntigravitySqliteUsageClient` 类。
- [ ] 解析 `conversation_summaries.db` 读取会话元数据（UUID、修改时间），过滤出在 `lookbackDays` 窗口内的有效会话。
- [ ] 针对目标 `conversations/<uuid>.db`，使用 SQLite 查询 `gen_metadata` 表。
- [ ] 利用 `protobufjs` 反序列化 Protobuf 数据包，提取官方上报的精确 Token（输入 Prompt Tokens、输出 Candidates Tokens，若有推理 Token 则独立拆分）。
- [ ] 对每条记录生成确定性的 dedupeKey（`antigravity:<conversationId>:<idx>`），并通过 `normalizeTokenObservation` 校验。
- [ ] 实现本地 JSON 缓存（比对文件 mtime），对未修改的 DB 库跳过查询与 Protobuf 解码。
- [ ] 编写单元测试，使用真实/合成的 SQLite fixture 验证解析准确性、增量缓存有效性与异常损坏库的容错能力。
