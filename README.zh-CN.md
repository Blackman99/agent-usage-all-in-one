![Agent Usage 横幅](static/brand/agent-usage-banner.svg)

# Agent Usage

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/Blackman99/agent-usage-all-in-one/actions/workflows/ci.yml/badge.svg)](https://github.com/Blackman99/agent-usage-all-in-one/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-usage-all-in-one.svg)](https://www.npmjs.com/package/agent-usage-all-in-one)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Agent Usage 是一个 macOS 优先、完全在本地运行的用量中心。一次启动即可统一查看
Codex、Claude Code、OpenCode Go 与 Grok 的原生额度窗口、刷新时间、Token、模型排行、
API 对等费用、历史与诊断。它只提供建议，不会自动切换 Agent。

## 核心页面

页面只有两个主要标签页：

- **Agent 用量**：保留各平台原生的 5 小时、周、月、All models 和 Fable only 等额度标签与刷新时间。
- **Token 与模型费用**：支持 24 小时、7 天和 30 天范围，展示 Token 分类、平台汇总、每日趋势、模型排行，以及符合条件的 Token 按公开 API 价格计算出的对等费用。

实际账单、平台报告估算、固定订阅费和 API 对等零售价是四类互不混合的证据。
API 对等零售价不是账单，也不会被描述成订阅支出。模型或价格未知时保持未分类或未定价，
不会猜测，更不会显示成 0。

Grok Build/SuperGrok 与 xAI API 是两个独立计费域，其额度、Token 和费用永远不会相加。

## 快速渐进式启动

本地 Web 服务会先启动，再在后台运行连接发现、平台用量、模型定价和保留整理四个独立模块。
已有缓存会立即展示；每个标签页只在自己的数据区域显示更新状态，已经完成的内容始终可用。

Transcript 扫描使用跨进程持久化且不保存原始个人路径的文件索引。历史费用只在价格目录版本变化时
重新计算；时间、平台、模型和计费域索引会在服务监听完成后由后台模块创建。设置里提供需要明确确认的
**硬重算全部数据**：它会忽略缓存、消耗较多资源，并且可能等待很久，但不会阻塞页面。

## 开发调试

```bash
pnpm install
pnpm dev
```

该命令会启动源码守护进程、带认证的 Vite 代理、热更新和页面。开发数据隔离在已忽略的
`.agent-usage-dev/` 目录。使用 `AGENT_USAGE_DEMO=1 pnpm dev` 加载演示数据；使用
`pnpm dev -- --no-open` 禁止自动打开浏览器。

## 安装与启动

要求 macOS 和 Node.js 24 或更高版本。

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

| 平台 / 计费域          | 原生额度                                            | Token 历史                           | 费用证据                                                      |
| ---------------------- | --------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| Codex                  | 可用时读取官方账户额度桶                            | 本地 rollout，并与账户日汇总对账     | API 对等零售价                                                |
| Claude Code            | 实验性官方客户端用量，包括 All models 与 Fable only | 本地会话记录；可选 OTLP 补充         | 客户端估算与 API 对等零售价                                   |
| OpenCode Go            | 官方账户级 5 小时、周、月窗口                       | 官方命令行或会话导出                 | 平台报告值或明确标注的估算                                    |
| Grok Build / SuperGrok | 实验性共享订阅额度                                  | 本地 `updates.jsonl`；可选 OTLP 补充 | 客户端估算与 API 对等零售价，包括可识别的 Grok 4.6 Build 别名 |
| Grok · xAI API         | 没有订阅额度                                        | 官方 Management API 聚合             | 可用时展示实际美元金额、余额、上限与账单                      |

每个数字都会保留来源权威等级和观测时间；账户全局与仅此 Mac 的证据始终明确区分。

## 凭据与隐私

官方客户端凭据始终留在原客户端中，不复制、不回显。可选的 xAI Management 密钥是唯一由
Agent Usage 管理的凭据，存储在 macOS 钥匙串。本地页面使用一次性启动令牌、HttpOnly
会话 Cookie 和同源写操作保护。

所有用量数据都留在本机。JSON/CSV 导出默认排除账户标识、会话 ID、Cookie、OAuth Token
和密钥值。原始观测保留 90 天，之后在事务中压缩为 UTC 日汇总。清理本地用量永远不会删除
Codex、Claude Code、OpenCode 或 Grok 官方客户端拥有的凭据。

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

## 许可证与社区

MIT，详见 [LICENSE](LICENSE)。另请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)、
[SECURITY.md](SECURITY.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) 和
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
