# Antigravity Provider Specification

**Status:** ready-for-agent

## Problem Statement

个人开发者在使用 Google Antigravity（包括终端命令行工具 `agy` 与 Antigravity IDE / 2.0 桌面端）进行 AI 辅助编程时，无法在 `agent-usage-all-in-one` 看板中直观追踪 Antigravity 的 Token 消耗趋势、模型分布（如 Gemini 3.7 Flash、Gemini 3.1 Pro、Claude Sonnet 4.6）以及等效公有云 API 价值（API Retail Equivalent）。

同时，Antigravity 本地并不暴露 CLI 配额查询子命令（如不存在 `agy quota`），所有模型会话历史分布在 SQLite 库（`conversations/*.db`）中，其生成元数据包含在二进制 Protobuf 数据包中。根据 ADR 003 的安全边界原则，Agent Usage 绝不能窃取、复制或重放用户存储在本地的 Google OAuth 凭证去逆向云端私有接口；必须通过纯本地、只读、增量缓存的方式，高效率提取官方上报的真实 Token 与会话历史。

## Solution

实现一个只读的 `antigravity` Provider 与对应的 `AntigravitySqliteUsageClient`：
1. **自动发现与凭据安全**：检查本地 Antigravity 路径（`~/.gemini/antigravity-cli` 与 `~/.gemini/antigravity`）或已安装的 `agy` 命令，向用户申请只读会话日志权限。Connector 的 `credentialOwner` 标定为 `official-client`，不读取或存储任何 OAuth token。
2. **两级增量提取**：
   - 第一级：读取中心索引库 `conversation_summaries.db`，依据请求的 `lookbackDays` 过滤修改时间在窗口内的会话 UUID。
   - 第二级：比对文件 `mtime`，未发生变更的会话直接复用本地 JSON 增量缓存；新发生变动的会话则读取 `conversations/<uuid>.db` 中的 `gen_metadata` 表。
3. **Protobuf 解码与语义归一化**：
   - 使用 `protobufjs` 解码 `gen_metadata.data` 中的 Prompt Tokens、Candidate/Completion Tokens、模型名称与请求耗时。
   - 依照 `core/token-normalization.ts` 规范，声明标准四元组语义（`reasoning: separate` 或 `included-in-output`，`cache: separate`）。
4. **多模型等效定价 (Retail Equivalent)**：
   - 将解析出的模型名称（`gemini-3.7-flash`、`gemini-3.1-pro`、`claude-sonnet-4-6` 等）匹配到对应供应商的公开价格快照。
   - 支撑模型排行榜（Model Ranking）、Treemap 细分图与订阅回本率（Plan Value Ratio）。
5. **降级声明**：
   - Quota Bucket 诚实声明为空（`expectedCoverage: ['tokens', 'history']`），卡片清晰说明 Antigravity 官方未在本地开放即时配额窗口查询。

## User Stories

1. As an Antigravity user, I want the onboarding flow to automatically detect my installed Antigravity CLI or IDE setup, so that I can monitor usage with a single click.
2. As a privacy-conscious developer, I want the connector to read only local conversation databases without touching my Google OAuth credentials, so that my account security is never compromised.
3. As a developer using multiple models in Antigravity, I want tokens attributed accurately to Gemini and Claude models, so that I can see the exact model breakdown in my dashboard.
4. As an Antigravity user, I want my turn-level prompt, candidate, and reasoning tokens accurately categorized, so that the Treemap and stacked charts display true token semantics.
5. As a heavy Antigravity user with hundreds of conversation databases, I want fast incremental scans under 50ms, so that refreshing the dashboard never freezes or causes disk thrashing.
6. As a subscriber to Gemini Code Assist, I want an API retail equivalent calculated for my Antigravity usage, so that I can calculate the Plan Value Ratio and know when my subscription breaks even.
7. As a user reviewing degraded states, I want an honest card status explaining that live quota windows are not exposed locally by Antigravity, so that I am not misled by fabricated numbers.
8. As a multi-surface developer using both `agy` CLI and the Antigravity desktop IDE, I want usage from both roots aggregated seamlessly without duplicate records, so that my statistics represent my entire workstation activity.

## Architecture & Implementation Decisions

1. **Connector Catalog Definition**:
   - `id`: `antigravity`
   - `displayName`: `Antigravity`
   - `command`: `agy`
   - `credentialOwner`: `official-client`
   - `expectedCoverage`: `['tokens', 'history']`
   - `target`: Provider `antigravity`, Billing Domain `code-assist-subscription`
   - `officialCredentialPaths`: `['.gemini/antigravity-cli', '.gemini/antigravity']`

2. **Client Seam (`AntigravitySqliteUsageClient`)**:
   - 接口契约对齐已有的 `TranscriptUsageClient`：
     ```ts
     export interface AntigravityUsageClient {
       readUsage(options?: CollectionRequest): Promise<LocalTranscriptUsageResult>;
     }
     ```
   - 依赖 Node 原生 SQLite (`node:sqlite`) 或无额外外部 native addon 的纯安全读取方式，结合 `protobufjs` 进行二进制流反序列化。

3. **Retail Pricing Catalog Snapshots**:
   - 在 `core/retail-pricing.ts` 中注册 `antigravity` 路由下的模型价格映射，支持 Gemini 3.7 / 3.6 / 3.1 系列以及通过 Antigravity 代理分发的 Claude 模型。

## Testing Decisions

- **Public Integration Seams**:
  - 在 `tests/unit/connectors/antigravity-connector.test.ts` 中针对合成的 SQLite 测试库与 mock `gen_metadata` protobuf 样本验证完整提取流水线。
  - 验证多根目录去重逻辑（同一 conversationId 出现在两个根路径下只记录一次）。
  - 验证增量缓存有效性：未更新文件不重复触发 Protobuf 解析。
  - 验证价格引擎对未知模型名称的 fallback 处理（进入 `unclassified` 而不引起崩溃）。

## Out of Scope

- 不尝试逆向或发起网络请求调用 `daily-cloudcode-pa.googleapis.com` 或 `loadCodeAssist` 接口。
- 不尝试管理、刷新或使用用户本地的 Google OAuth Token。
- 不支持动态 5 小时 / 每周重置配额倒计时（直到官方提供本地只读查询接口）。
- 不支持将 Antigravity 的模型路由自动切换到其他第三方 API 提供商。
