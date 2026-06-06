# Agent CLI

> 一个本地优先（local-first）的命令行编码助手，**构建于开源 [pi](https://pi.dev) agent 框架（MIT）之上** —— 通过其公开 SDK 以库的方式引入，从不 fork。
>
> pi 提供 agent 主循环、工具、会话树和上下文压缩。Agent CLI 在此之上补齐一个团队**真正落地**一个 agent 所需的能力：**声明式的安全/审批策略层**、**MCP 工具集成**、**评测/基准测试框架**，以及**跨会话的项目记忆**。

---

## pi 提供的能力 / 我新增的能力

| 能力 | pi（作为库使用） | Agent CLI（净新增） |
|---|---|---|
| Agent 循环、工具调用、状态 | ✅ 原生 | 原样复用 |
| 读/写/编辑/bash 工具 | ✅ 原生 | 复用，并**用策略网关加固** |
| 会话持久化 / 恢复 / 分叉 | ✅ 原生（树形 JSONL） | 复用；TaskView 由其投影而来 |
| `-p` print 模式 / SDK / RPC | ✅ 原生 | 在我们的 CLI 中做了薄封装 |
| **声明式审批模式状态机 + 命令风险分级** | ❌ | ★ 净新增（C2） |
| **MCP 工具集成**（stdio JSON-RPC） | ❌ | ★ 净新增（C5） |
| **评测 / 基准测试框架**（确定性、离线、模型×场景矩阵） | ❌ | ★★ 净新增 —— 招聘信号最强（C4） |
| **项目画像 + 跨会话记忆** | ❌ | ★ 净新增（小而真实） |

## 快速开始

```bash
npm install            # 触发 postinstall 去重，faux-provider 测试依赖它
npm run build          # esbuild -> dist/cli.js（原生 spawn 被禁用时回退到 TS）
npm test               # vitest（离线、faux provider、零 LLM 调用）

# 命令（C2 —— v0.2 策略网关）
agent --version
agent --help
agent init             # 检测项目画像并生成 .agent/
agent -p "这个项目是做什么的?"          # 只读 print 模式问答（默认：suggest）
agent --mode auto -p "写一个工具函数"    # 自动批准安全写入，deny 仍然是硬拒绝
agent review           # 审查 git diff 的策略风险与缺失的测试
agent history          # 列出当前 cwd 的 pi 会话（C3）
agent trace [id]       # 显示某次会话的任务轨迹摘要 TaskView（默认最近一次，C3）
agent resume <id> "…"  # 按 id 或路径恢复 pi 会话并续跑（C3）
agent diff             # 显示已暂存/未暂存的文件 diff（C3）
agent undo             # 仅 stash 文件改动；命令副作用不会被撤销（C3）
agent eval --provider faux   # 确定性离线评测矩阵（C4）
agent eval --provider real --scenario hono-health-header --model claude-sonnet-4-6
agent mcp list               # 列出 .agent/mcp.json 中的 stdio 服务器（C5）
npm run demo:faux            # 离线 hero 演示（C6）
```

v0.2 引入了**声明式审批模式策略网关**：`readonly`｜`suggest`｜`workspace-write`｜`auto`。所有工具调用在执行前都会流经 `classify(bash, path, mode, policy)`。一套对抗性测试用例（离线）证明了这道"减速带"能拦下 `rm -rf`、`curl | sh`、写入 `.env`、以及读取仓库根目录之外的路径。

v0.3 引入了**循环护栏 + 任务轨迹 + diff/undo**。扩展顺序固定为 policy → loopGuards → traceRecorder → 后续 adapter，因此策略拒绝会在预算计数之前短路返回。循环护栏强制执行 `maxToolCalls`、在 fix-test 类任务中阻止对测试文件的"刷分"式写入、对重复出现的同一测试失败做软停止、并为交接保留当前工作区 diff。轨迹条目（`task-meta`、`task-tool-call`、`task-result`）持久化在 pi 会话中；`agent history`、`agent resume`、`agent trace`、`agent diff`、`agent undo` 都建立在这唯一可信源之上。`agent undo` 使用 `git stash --include-untracked`，且只回退文件，不回退命令副作用。

v1.0 完成 **C4–C6**：`agent eval --provider faux` 运行确定性的 fixture 评分并支持 baseline diff；`agent eval --provider real --scenario …` 在配置了凭证时可运行一个真实 provider 的冒烟场景；`agent mcp add/list/remove` 管理 stdio MCP 服务器并注册 `mcp__server__tool` 动态工具；bash 调用受 `commandTimeoutMs` 硬上限约束；token 预算通过会话用量软停止；`npm run demo:faux` 提供离线发布演示。打包后的 CLI 报告版本为 `1.0.0`。

## 架构

```
Agent CLI（独立二进制 —— 以 `import` 方式引入 npm 上的 pi）
├── SDK 层        → createAgentSession / SessionManager / SettingsManager
├── 扩展层        → policyGateway / loopGuards / traceRecorder / commandTimeoutBash / rememberTool / mcpAdapter
│                    （进程内扩展工厂，与 pi 扩展同一套模型）
└── 策略 + 度量层  → 声明式引擎 / MCP adapter / 评测框架 / 记忆
```

## 威胁模型（诚实声明）

- **策略引擎是一道"减速带"**（字符串层面的 bash 分类、基于 glob 的路径拒绝），
  它**不是**操作系统级的安全边界 —— `cat ~/.ssh/id_rsa` 可以绕过它。
- `policy.sandbox.enabled` 在 v1.0 中是**预留字段**：配置后会给出警告，但尚未接入真正的 OS 沙箱。
- 一套对抗性测试用例证明了这道减速带能拦住什么；操作系统级沙箱仍是已记录在案的后续工作。

发布边界详见 [`docs/known-limitations.md`](docs/known-limitations.md)。

## 测试

```bash
npm test
```

全套件共 **151 个测试**（30 个文件），全部离线、使用 faux provider、零 LLM 调用。其中策略层是核心：`test/policy/` 下 **73 个测试**，包含一张 **16 个对抗用例**的表（`test/policy/adversarial.test.ts`），逐条验证减速带能拦下哪些攻击。

## 开发周期

完整规划见 [`docs/`](docs/)：

| 周期 | 主题 | 净新增 |
|---|---|---|
| C0 | 基础设施 + faux 测试框架 | ★ headless 确定性基础设施 |
| C1 | SDK 外壳 + 只读理解 | 项目画像 / 记忆注入 |
| C2 | 安全策略层 | ★ 审批模式状态机 + 对抗测试 |
| C3 | 循环护栏 + 任务轨迹 + diff/undo | ★ 预算 / 反刷分 |
| C4 | 评测 / 基准测试框架 | ★★ 度量（信号最强） |
| C5 | MCP adapter + GitHub 演示 | ★ 外部工具集成 |
| C6 | 加固、演示、发布 | 集成测试 + hero 演示 |

## 许可证

MIT —— 见 [LICENSE](LICENSE)。

本项目构建于由 Mario Zechner（[earendil-works](https://github.com/earendil-works)）创建的 [pi](https://pi.dev) agent 框架之上，pi 同样基于 MIT 许可证。
