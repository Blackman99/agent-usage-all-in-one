# Agent Usage

Agent Usage 是一个 macOS 优先、完全本地运行的 coding-agent 用量中心。一次启动即可统一查看 Codex、Claude Code、OpenCode Go 与 Grok 的额度、刷新时间、Token、费用、历史、预测和诊断；它只给出建议，不会自动切换 agent。

界面支持简体中文和 English。Grok 在一张 provider 卡片内明确分隔 `Build / SuperGrok` 与 `xAI API` 两个 billing domain，二者不会合并计数。

## Usage-first Dashboard V2

首页默认显示最近 7 天，并记住本机最后选择的 `24h`、`7d` 或 `30d` 时间窗口与 CNY/USD 展示币种。页面顺序固定为：全局摘要 → 四张 Provider 用量卡 → Token 与金额工作台 → 模型排行；连接状态和恢复动作直接位于对应 Provider 卡内，不再用独立配置面板抢占首屏。

全局摘要展示已记录 Token、API 等价零售价及其定价覆盖率、最紧张原生 quota bucket 和最新观测时间。工作台将以下三类金额严格分开：

- `actual`：Provider 账单实际费用；
- `reported-estimate`：Provider 或客户端报告的估算；
- `retail-equivalent`：按版本化官方 API 零售价计算的对等价值，不是账单。

固定订阅费只保留在计费明细和导出中，不会按 Token、模型或日期摊派。趋势按 Provider 展示，模型排行按 Provider 与 billing domain 隔离；无法识别模型、Token 类型或价格档位的数据保持 unclassified/unpriced，不会猜测或写成 0。

Token 证据会明确标出账户或本机范围、event/hour/day/billing-period 时间精度、分类覆盖率和定价覆盖率。切换分析窗口不会改写 Provider 原生的 5 小时、周、月等 quota 窗口。Monitoring、完整 Diagnostics、Privacy、导出、保留和清理统一放在顶部“设置”抽屉。

## 开发调试

在仓库根目录执行：

```bash
pnpm install
pnpm dev
```

这一个命令会启动源码 daemon、Vite 热更新、认证代理并自动打开 Dashboard。开发数据库保存在仓库内已忽略的 `.agent-usage-dev/`，Keychain 与登录启动项也使用独立的开发命名空间；按 `Ctrl+C` 会同时关闭前后端，不会改动正式运行状态。

需要演示数据时执行 `AGENT_USAGE_DEMO=1 pnpm dev`。不希望自动打开浏览器时执行 `pnpm dev -- --no-open`。Svelte 修改会热更新；后端 TypeScript 修改后重新运行 `pnpm dev` 即可。

## 安装与启动

要求 macOS 与 Node.js 24 或更高版本。P0 tarball 可按以下方式安装：

```bash
pnpm install
pnpm build
pnpm pack
npm install --global ./agent-usage-all-in-one-0.1.0.tgz
agent-usage
```

`agent-usage` 会启动仅绑定 `127.0.0.1` 的本地 daemon，并用一次性 launch token 打开 Dashboard。应用数据默认位于 `~/Library/Application Support/Agent Usage`。

常用命令：

```bash
agent-usage status --window 7d
agent-usage doctor
agent-usage export --format json --window 30d
agent-usage export --format csv --window 7d
agent-usage export --format json --window 30d --include-account-identifiers
agent-usage retention --json
agent-usage retention --compact
agent-usage monitoring --json
agent-usage start-at-login enable
agent-usage clear --yes
```

## Provider coverage

| Provider / billing domain | Quota 与 reset                                                            | Token / history                     | Cost                                          | 数据等级与边界                                                    |
| ------------------------- | ------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| Codex                     | 官方 app-server 能力可用时读取动态 bucket                                 | 官方账户能力可用时读取              | 未知，不显示为 0                              | official account；旧版本缺方法时按维度降级                        |
| Claude Code               | 实验性官方客户端 `/usage` adapter；保留 All models、Fable only 等原始标签 | 用户显式开启的本地 OTLP             | 未知                                          | quota 为 experimental official client；Token 为 local observation |
| OpenCode Go               | 官方 account-wide 5 小时、周、月窗口                                      | 官方 CLI/session export，本机范围   | provider 报告值或明确 estimate                | 账户 quota 与本机 history 永远分开标注                            |
| Grok Build / SuperGrok    | 实验性官方客户端能力，可得共享周额度                                      | 用户显式开启的 OTel/headless 输出   | 未知                                          | 不虚构 5 小时 bucket；客户端能力缺失时保留本地历史                |
| Grok · xAI API            | API 计费域无订阅 quota                                                    | 官方 Management API 按模型/时间聚合 | actual USD、balance、limit、invoice（可得时） | 需要独立 Management key；与 Build 订阅不相加                      |

每个数字都保留 data authority：`official-account`、`official-client`、`local-observation`、`estimate` 或 `unavailable`。实际费用、订阅费用和 API 等价估算是三个独立 cost kind；未知费用始终为 unknown，而不是 0。

## 权限与凭据

- Codex、Claude Code、OpenCode Go 与 Grok 的官方客户端凭据只在原位置使用，不复制、不回显。
- xAI Management key 是 Agent Usage 唯一创建的凭据，存储于 macOS Keychain；SQLite 只记录非敏感连接状态。
- Claude/Grok telemetry 默认关闭，只有执行 `agent-usage telemetry-env --provider claude-code|grok` 并在相应 shell 中显式启用后才发送到本机 daemon。
- Dashboard session 使用一次性 launch token、HttpOnly cookie 与同源写操作保护；CLI 使用权限受限的本地 daemon state。

## 隐私、导出与保留

所有数据留在本机。JSON/CSV 导出默认不包含账户标识、session id、cookie、OAuth token、secret reference 或 secret value，并记录查询窗口、freshness、authority、Token 与独立 cost kind。只有显式使用 `--include-account-identifiers`（或在 Dashboard 勾选对应选项）时才会包含可用的账户标识；secret 永远不会导出。

原始 usage observation 保留 90 天。压缩任务先在事务内生成固定 UTC 日聚合，成功后才删除旧原始记录；重复运行、重启和显示时区变化不会重复计数。Dashboard 的“隐私与数据”区会显示当前 raw/aggregate 数量。

`agent-usage clear --yes` 只清理本地 usage 数据。若明确执行 `agent-usage clear --yes --include-product-secrets`，还会删除 Agent Usage 自己创建的 Keychain entries；Codex、Claude、OpenCode 或 Grok 官方客户端拥有的 credentials 永远不在删除范围内。

卸载：

```bash
npm uninstall --global agent-usage-all-in-one
```

卸载 package 不会静默删除个人历史。如需彻底删除，先运行 clear，再手动移除 `~/Library/Application Support/Agent Usage`。

## 故障恢复

运行 `agent-usage doctor` 可检查 daemon、database、binary、连接状态、billing domain、freshness、影响的 coverage 和恢复动作。诊断区分 missing binary、not configured、unauthorized、unsupported、schema mismatch、rate limited、timeout、stale 与 unavailable。一个 connector 失败只会降级自己的范围，不会隐藏其他 provider。

常见恢复顺序：安装或升级对应官方 CLI → 在官方客户端完成登录 → 在对应 Provider 卡点击“管理连接”（或打开顶部“设置”抽屉）重试 → 手动 Refresh → 再运行 doctor。实验性 connector 会在界面明确标注；未知 schema 一律 fail closed。

## 开发与验收

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm test:e2e
```

真实 connector 检查必须显式 opt-in，普通测试不读取个人 credentials。脱敏发布收据见 [`docs/release/connector-receipts-2026-08-28.md`](docs/release/connector-receipts-2026-08-28.md)，V2 验证记录见 [`docs/release/p0-validation-2026-08-28.md`](docs/release/p0-validation-2026-08-28.md)，官方定价证据见 [`docs/research/official-pricing-sources-2026-08-28.md`](docs/research/official-pricing-sources-2026-08-28.md)，本地品牌资产审计见 [`static/brands/README.md`](static/brands/README.md)。

## English summary

Agent Usage is a private local macOS dashboard and CLI for Codex, Claude Code, OpenCode Go, and Grok. It preserves provider-native quota labels, separates Grok Build from xAI API billing, distinguishes actual/subscription/estimated cost, supports 24h/7d/30d views, and never switches agents. Credentials remain in their official clients or in the product-owned Keychain entry for the optional xAI Management API connector. See the sections above for installation, privacy, retention, diagnostics, export, deletion, and release verification.

## License

MIT — see [`LICENSE`](LICENSE).
