![Agent Usage 仪表盘功能展示](static/brand/agent-usage-showcase.jpg)

# Agent Usage

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/Blackman99/agent-usage-all-in-one/actions/workflows/ci.yml/badge.svg)](https://github.com/Blackman99/agent-usage-all-in-one/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-usage-all-in-one.svg)](https://www.npmjs.com/package/agent-usage-all-in-one)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **macOS 上的本地多 Agent 用量中心——一个仪表盘，无云端，不自动切换。**

Agent Usage 是一个 macOS 优先、完全在本地运行的用量中心。一次启动即可统一查看
Codex、Claude Code、OpenCode、Grok、dsh 与 Antigravity 的原生额度窗口、刷新时间、Token、模型排行、
API 对等费用、历史与诊断。它只提供建议，不会自动切换 Agent。

## 对比说明

![类别对比：各平台官网、Token 导出工具、FinOps 看板与 Agent Usage](docs/design/compare-sheet.png)

按类别对比何时更适合用 Agent Usage，而非各平台官网、导出工具或通用 FinOps 看板：[docs/comparison.md](docs/comparison.md)。

具名竞品对照（ccusage、CodeBurn、Token Monitor、TokenTracker）：[docs/named-competitors.md](docs/named-competitors.md)。

**边界：** 暂不支持 Cursor · 仅 macOS · 对已列出的 Provider 做多 Agent 用量中心（不夸大 “all-in-one”）。

## 核心页面

页面只有两个主要标签页：

- **Agent 用量**：保留各平台原生的 5 小时、周、月、All models 和 Fable only 等额度标签与刷新时间。
- **Token 与模型费用**：支持 24 小时、7 天和 30 天范围。所选窗口、指标与币种和主标签页共用同一条吸顶导航。汇总卡片左侧是金额或 Token 头条，右侧是过去一年的 GitHub 风格用量墙（只统计计入摘要的已记录 Token），随后用图表展示 Provider 占比和可交互的每日趋势，再以占比条呈现模型排行及符合条件的 Token 按公开 API 价格计算出的对等费用。用量墙与所选的 24 小时 / 7 天 / 30 天窗口相互独立。
- **设置面板**：采用居中双栏结构，将连接管理、自定义模型费率、运行监控、系统诊断与数据隐私划分为 5 个独立分类，方便高效维护各项配置。

实际账单、平台报告估算、固定订阅费和 API 对等零售价是四类互不混合的证据。
API 对等零售价不是账单，也不会被描述成订阅支出。模型或价格未知时保持未分类或未定价，
不会猜测，更不会显示成 0。

Grok Build/SuperGrok 与 xAI API 是两个独立计费域，其额度、Token 和费用永远不会相加。

## 快速渐进式启动

本地 Web 服务会先启动，再在后台运行连接发现、平台用量、模型定价和保留整理四个独立模块。
已有缓存会立即展示；每个标签页只在自己的数据区域显示更新状态，已经完成的内容始终可用。

本地会话记录扫描使用跨进程持久化且不保存原始个人路径的文件索引。历史费用只在价格目录版本变化时
重新计算，并按有限批次处理；时间、平台、模型和计费域索引及保留期整理会在平台采集完成后交给后台
工作线程执行。设置里提供需要明确确认的
**硬重算全部数据**：它会忽略缓存、消耗较多资源，并且可能等待很久，但不会阻塞页面。

## 开发调试

```bash
pnpm install
pnpm dev
```

该命令会启动源码守护进程、带认证的 Vite 代理、热更新和页面（默认分配随机可用端口）。开发数据隔离在已忽略的
`.agent-usage-dev/` 目录。使用 `pnpm dev -- --port 3000`（或环境变量 `AGENT_USAGE_DEV_PORT=3000`）自定义端口；使用 `AGENT_USAGE_DEMO=1 pnpm dev` 加载演示数据；使用
`pnpm dev -- --no-open` 禁止自动打开浏览器。

## 安装与启动

要求 macOS 和 Node.js 24 或更高版本。这是受支持的运行时（内置 `node:sqlite`、钥匙串、LaunchAgent），不是文档疏漏——见 [ADR 017](docs/adr/017-macos-node24-npm-runtime.md) 和 [平台路线图](docs/platform-roadmap.md)。尚未提供 Linux，也没有 Homebrew / DMG。

```bash
npx agent-usage-all-in-one
```

可选全局安装：

```bash
npm install --global agent-usage-all-in-one
agent-usage
```

从源码构建并安装：

```bash
pnpm install
pnpm build
archive=$(pnpm pack)
npm install --global "./$archive"
agent-usage
```

守护进程只绑定 `127.0.0.1`。应用数据默认保存在
`~/Library/Application Support/Agent Usage`。

常用命令：

```bash
agent-usage status --window 7d
agent-usage doctor
agent-usage export --format json --window 30d
agent-usage export --format csv --window 7d
agent-usage retention --json
agent-usage retention --compact
agent-usage monitoring --json
agent-usage start-at-login enable
agent-usage clear --yes
```

## 平台覆盖范围

| 平台 / 计费域                    | 原生额度                                                                                      | Token 历史                                                                   | 费用证据                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Codex                            | 可用时读取官方账户额度桶                                                                      | 本地 rollout，并与账户日汇总对账                                             | API 对等零售价                                                 |
| Claude Code                      | 实验性官方客户端用量，包括 All models 与 Fable only                                           | 本地会话记录；可选 OTLP 补充                                                 | 客户端估算与 API 对等零售价                                    |
| OpenCode Go                      | 官方账户级 5 小时、周、月窗口                                                                 | 与本地历史分开                                                               | 仅作为额度上下文                                               |
| OpenCode · 本地历史              | 没有订阅额度                                                                                  | 所有已完成的本地请求，覆盖已配置 Provider                                    | 客户端报告估算；符合条件时计算 API 对等零售价                  |
| Grok Build / SuperGrok           | 实验性共享订阅额度                                                                            | 本地 `updates.jsonl`；可选 OTLP 补充                                         | 客户端估算与 API 对等零售价，包括可识别的 Grok 4.6 Build 别名  |
| Grok · xAI API                   | 没有订阅额度                                                                                  | 官方 Management API 聚合                                                     | 可用时展示实际美元金额、余额、上限与账单                       |
| dsh · DeepSeek API               | 没有订阅额度                                                                                  | 本机 dsh 全部 profile 的会话日志，含基于 dsh 的终端前端                      | 按 DeepSeek 公布的峰谷价计算 API 对等零售价                    |
| Antigravity · Gemini Code Assist | 通过官方 Language Server 本地 RPC 获取 5 小时冲刺窗口与周度基准额度，支持本地会话分析平滑降级 | 本地会话 SQLite 数据库（~/.gemini/antigravity-cli 与 ~/.gemini/antigravity） | 按公布的 Google Gemini 及第三方模型公开价格计算 API 对等零售价 |

每个数字都会保留来源权威等级和观测时间；账户全局与仅此 Mac 的证据始终明确区分。

## 凭据与隐私

官方客户端凭据始终留在原客户端中，不复制、不回显。可选的 xAI Management 密钥是唯一由
Agent Usage 管理的凭据，存储在 macOS 钥匙串。本地页面使用一次性启动令牌、HttpOnly
会话 Cookie 和同源写操作保护。

所有用量数据都留在本机。JSON/CSV 导出默认排除账户标识、会话 ID、Cookie、OAuth Token
和密钥值。原始观测保留 90 天，之后在事务中压缩为 UTC 日汇总。清理本地用量永远不会删除
Codex、Claude Code、OpenCode、Grok、dsh 或 Antigravity 官方客户端拥有的凭据。

## 验证

```bash
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm test:e2e
```

可查阅[官方定价证据](docs/research/official-pricing-sources-2026-08-28.md)、
[连接验证收据](docs/release/connector-receipts-2026-08-28.md)与
[开源说明](docs/open-source.md)。

## 路线图愿景（未交付）

Linux、Homebrew 和 DMG 在满足 [docs/platform-roadmap.md](docs/platform-roadmap.md)
中的条件之前不会进入产品。菜单栏一览见 [issue #19](https://github.com/Blackman99/agent-usage-all-in-one/issues/19)，
仓库中的示意图只是愿景，不是现有功能。

## 许可证与社区

MIT，详见 [LICENSE](LICENSE)。另请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)、
[SECURITY.md](SECURITY.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) 和
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
