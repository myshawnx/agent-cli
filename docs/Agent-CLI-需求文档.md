# Agent CLI 需求文档 v2

> 本版的核心改动:**不再把自己写成"又一个 coding agent"。** pi（`@earendil-works/pi-coding-agent`）是一个商用级、开源的 agent harness——它已经原生具备 agent loop、工具层、会话树、压缩、`-p` 模式、SDK，甚至 ship 了命令审批 / 路径保护 / git checkpoint 的示例扩展。本项目把 **pi 当 runtime/library 用（通过 SDK，不 fork）**，只在 pi 没覆盖的接缝上做三件真正属于"agent 工程"的事：**外部工具集成（MCP）、安全策略层、效果度量（eval）**。

---

## 1. 项目名称

`Agent CLI`（暂定，对外可叫 PiCoder / RepoAgent）。

---

## 2. 一句话定位

> 一个**构建在 pi SDK 之上**的本地优先 CLI 编程助手；把 pi 的 agent runtime 当库使用，叠加一层**可声明的安全策略、MCP 工具集成、和一个可回归的 eval 度量体系**，并提供面向 CI/脚本的子命令封装。

它不重写 pi 已有的能力，而是补齐"要把一个 agent 真正交付/上线"时团队必须自己做的那部分。

---

## 3. 与 pi 的边界（本文档最重要的一张表）

> 这张表是为了在面试里直接回答 **"pi 本身就是 coding agent，你到底做了什么？为什么不直接用它？"**

| 能力 | pi 现状 | 本项目的取舍 |
|---|---|---|
| Agent loop / 工具调用 / state | **原生**（`packages/agent`） | **直接复用**，不碰 |
| read/write/edit/grep/ls/bash 工具 | **原生**，含 fuzzy edit、mutation queue、BOM/CRLF、输出截断 | **直接复用**，明确不重写 |
| 会话持久化 / resume / fork / 压缩 | **原生**，树状 JSONL + `/resume /tree /fork` + 结构化压缩 | **直接复用**，task 视图从它投影 |
| `-p` 一次性 / `--mode json` / SDK / RPC | **原生**（`modes/print-mode.ts`、`createAgentSession`） | **直接复用**，CLI 薄封装在上面 |
| skills（bugfix/test-writer/...） | **原生**（`SKILL.md` + `/skill:name`） | **以 pi skill 形式提供**，不自研加载器 |
| 命令审批 / 敏感路径 / git checkpoint | **有示例扩展**（permission-gate / protected-paths / dirty-repo-guard / git-checkpoint） | **作为基线**，我做得更进一步（见 §5.1） |
| **声明式 approval-mode 状态机 + 命令风险分级** | **没有**（pi 只有硬编码正则示例 + 静态 tool 白名单） | **★ 本项目新增** |
| **MCP 工具集成** | **明确没有**（README: *"No MCP. … build an extension that adds MCP support."*） | **★ 本项目新增** |
| **Eval / benchmark harness** | **完全没有** | **★ 本项目新增（最高信号）** |
| **项目画像 + 跨会话长期记忆** | pi 只跟踪当前会话；无结构化 profile、无跨会话 memory | **★ 本项目新增（小但真）** |

**一句话立论**：pi 给我 loop、工具、会话、压缩、SDK；我加 **策略层（安全）+ 集成层（MCP）+ 度量层（eval）+ 项目记忆**。前者是基础设施，后者是把 agent 真正交付出去的工程。

---

## 4. 架构与集成方式（先回答"怎么 built ON pi"）

**结论：本项目是一个独立可执行文件，`import` pi 的 SDK，绝不 fork pi。**

pi 的扩展跑在 pi 进程内，**改不了** CLI argparse、入口、模式选择——所以自定义子命令必须走 SDK 路径。三层职责划分清晰：

```
Agent CLI (独立 binary)
├── ① SDK 层（我拥有进程入口）
│     createAgentSession / SessionManager / SettingsManager / ResourceLoader
│     ├─ 自己的 argparse（Commander/CAC）+ 子命令（run/ask/review/mcp/eval...）
│     ├─ 复用 pi 的 print mode 做 -p
│     └─ 注入系统提示 + profile/instructions/memory
│
├── ② 扩展层（跑在 pi 进程内的 in-process 扩展）
│     pi.on("tool_call") 安全网关 + pi.registerTool(MCP 工具) + pi.appendEntry(task 元数据)
│
└── ③ 策略 + 度量层（我的核心工程，pi 没有）
      安全策略引擎 / MCP adapter / eval harness / 项目记忆
```

SDK 入口示意（基于真实 API，参考 `examples/sdk/12-full-control.ts`）：

```ts
import { createAgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  cwd, agentDir,
  model,
  tools: resolveToolsForMode(approvalMode),        // 我的策略：readonly 模式直接排除 write/edit/bash
  resourceLoader,                                  // 注入 profile/instructions/memory 到系统提示
  sessionManager: SessionManager.create(cwd),      // 单一真相源 = pi 的 session
  settingsManager: SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2 } }),
  // 我的扩展在这里挂载：安全网关、MCP 工具、task trace
});
```

---

## 5. 四大核心模块（net-new，这是项目的真实内容）

### 5.1 安全策略层（比 pi 示例更进一步）

pi 的 `permission-gate.ts` 只是 ~30 行硬编码正则、且 block-by-default、没有 approval-mode 概念。本项目把它升级为**声明式策略引擎 + 一等公民的审批模式状态机**。

**审批模式（pi 没有这个概念，我用 SDK + 扩展实现）：**

| 模式 | 强制机制（具体到 pi 接口） |
|---|---|
| `readonly` | 启动时 `tools` 白名单**排除** write/edit/bash/apply_patch（硬隔离，非提示级） |
| `suggest` | 允许 edit 计算 diff，但在 `tool_call` 拦截、返回 diff **不落盘**；bash 强制只读/确认 |
| `workspace-write` | 允许 cwd 内写；越界路径 + 敏感清单**阻断**；confirm 类操作 `ctx.ui.confirm` |
| `auto` | 不弹确认，但 **deny 清单依然硬生效**（修正 v1 矛盾：auto ≠ 放飞） |

**命令风险分级（声明式 config 驱动，可测）：**

```jsonc
// .agent/policy.json
{
  "command": {
    "allow":   ["pnpm test", "pnpm lint", "pnpm build", "pytest", "go test"],
    "confirm": ["pnpm add", "npm install", "git commit", "git push", "docker compose up"],
    "deny":    ["rm -rf", "sudo", "curl | sh", "wget | sh", "chmod -R", "dd", "mkfs"]
  },
  "path": { "deny": [".git/", ".env", "**/*.pem", "~/.ssh/**", "**/credentials*"] }
}
```

挂载方式（真实接口，模仿 permission-gate.ts）：

```ts
pi.on("tool_call", async (event, ctx) => {
  const verdict = policy.classify(event, approvalMode);     // 我的策略引擎
  if (verdict.kind === "deny")    return { block: true, reason: verdict.reason };
  if (verdict.kind === "confirm") {
    if (!ctx.hasUI) return { block: true, reason: "需确认但无 UI（-p 模式）" }; // 修正：非交互必须保守
    const ok = await ctx.ui.confirm("高风险操作", verdict.reason);
    if (!ok) return { block: true, reason: "用户拒绝" };
  }
  return undefined;
});
```

**威胁模型（必须在文档里写清楚，否则一问就崩）：**
路径黑名单**挡不住 bash**——`cat ~/.ssh/id_rsa`、`> .env` 都绕过 write/edit（pi 自己的 protected-paths 也只挡 write/edit）。本项目采取**双轨 + 诚实表述**：
- 默认：bash 命令经过同一策略引擎做**字符串级风险分级**（减速带，**不号称是安全边界**）。
- 强保护可选：接入 pi 的 `@anthropic-ai/sandbox-runtime` 扩展做 **OS 级 denyRead/denyWrite**（真边界，仅 macOS/Linux）。
- 文档**不把"deny .env"写成铁律卖点**，而写成"策略 + 可选沙箱"，并交付一个**对抗性测试套件**证明拦截行为。

### 5.2 MCP-to-Pi adapter（pi 明确没有，README 邀请你做）

```
MCP server (stdio, JSON-RPC) → adapter → pi.registerTool() → agent 可调用
```

要点（也是面试会深挖的真实难点）：
- **发现**：`session_start` 时按 config 启动 MCP server，调 `tools/list`。
- **schema 映射**：MCP 的 JSON Schema → pi 工具的 TypeBox 参数；**诚实标注**只支持子集（object + string/number/enum/array），`oneOf/$ref/递归` 走宽松 passthrough + 运行时校验，映射不了的工具**跳过并告警**（不假装"已解决"）。
- **输出**：MCP 结果复用 pi 的 `truncateHead/truncateTail`，避免 50KB JSON 撑爆上下文。
- **生命周期**：server spawn/crash/restart；崩溃不能把 pi 的 loop 卡死。
- **Demo**：`agent mcp add github` → 读 issue #12 → 改代码 → 生成 PR summary。

### 5.3 Eval / Benchmark harness（最高信号，pi 零覆盖）

> agent 开发岗最看重"你怎么知道它真的行、改了 prompt/model 怎么知道没退化"。这是把项目从"演示"抬到"工程"的关键。

- **fixture**：一个 planted-bug TS repo（含 token 过期 500→401 等 5–10 个场景）。
- **打分**：每个场景自动判定 `{找到 bug, 修复, 新增测试通过, 产出 diff, 未越权}`。
- **回归表**：同一套场景跑在不同 model / prompt 版本上，输出对比表，能检测"某次 prompt 改动让 test-loop 退化"。
- **隔离**：用 pi 的 pluggable operations / 录制式假 provider 跑，**不烧真实 LLM 调用**做单测。

### 5.4 项目画像 + 跨会话记忆（只装 pi 没有的）

`.agent/` **只保存 pi 确实缺的东西**，避免与 pi 的 `AGENTS.md` / `.pi/settings.json` 重复：

```
.agent/
├── project-profile.json   # 探测到的 stack / 命令（pi 不持久化）
├── memory.md              # 跨会话长期记忆（pi 只有单会话）
└── policy.json            # 我的安全/审批策略（§5.1）
```

- **不再造** `instructions.md`：直接复用 pi 的 `AGENTS.md`（pi 原生加载）。
- **配置优先级写死**：CLI flag > `.agent/policy.json` > pi 默认。
- profile/memory 通过 `ResourceLoader` 注入系统提示。

---

## 6. CLI 设计（SDK 上的薄封装）

```bash
agent "<自然语言任务>"      # 交互式，默认 suggest 模式
agent -p "总结当前 diff"     # 复用 pi print mode；非交互，默认不写盘
cat err.log | agent -p "解释这个错误"

agent review                # 读 git diff → 风险/缺测试/建议
agent diff | agent undo     # diff 复用 pi 渲染；undo 复用 git checkpoint
agent mcp add <server>      # MCP（§5.2）
agent eval [--model m]      # ★ 跑 eval harness（§5.3），输出回归表
agent init                  # 生成 .agent/（profile + policy + memory 骨架）
```

`undo` 明确边界（修正 v1 过度承诺）：**只撤销文件改动**（基于 pi 的 git-checkpoint / `git stash`），**不撤命令副作用**（装的包、DB 写入、网络调用）——文档明说这一点。

---

## 7. Agent 工作流（重点：test-fix loop 的控制流自己拥有）

修改类任务：理解 → `git status` → 搜索 → 读关键文件 → 简短计划 →（按模式确认）→ 改 → 跑测试 → **失败则进入受控修复循环** → 展示 diff → 总结 → 写 task trace。

**test-fix 循环的控制流（v1 缺失，这里补成项目的"判断力展示位"）：**
- **谁驱动**：pi 的 agent loop 天然会迭代调用 bash；我**在上层加守卫与终止条件**，而不是另造 workflow 引擎（呼应"不用 LangGraph"）。
- **预算**：`maxFixIterations`（默认 5）、`maxToolCalls/turn`、token/cost 上限——**到顶即停**并产出 diff+总结交人，杜绝跑飞。
- **防死循环**：同一组测试连续两轮失败且无新增通过 → 判"无进展"，停止升级。
- **防 reward hacking**：任务是"修代码让测试过"时，**检测并拒绝对测试文件本身的改动**；记录修复前后通过数,防止用删断言骗过。
- **失败保全**：放弃时保留部分进度（diff + 失败摘要），不回滚到一无所有。

---

## 8. 错误处理与资源预算（v1 完全缺失，新增）

明确划分**委托 pi** vs **自己管**：

| 失败场景 | 归属 |
|---|---|
| LLM API 限流 / 5xx / 超时 | 委托 pi（`SettingsManager` retry 配置） |
| 畸形 tool args | 委托 pi（参数 schema 校验） |
| 大输出撑爆上下文 | 委托 pi（truncate / OutputAccumulator） |
| Ctrl-C / SIGTERM 中断 | 接 pi 的 abort signal，落到 §7 的"失败保全" |
| 测试命令挂死 | **自己管**：命令超时 → 杀进程 → 计一次失败 |
| patch fuzzy 匹配失败 | **自己管**：报告无法定位 → 不静默写错位置 |
| 预算耗尽 | **自己管**：停 + 总结（§7） |

---

## 9. 上下文与持久化（单一真相源，修正 v1 双写矛盾）

- **会话真相源 = pi 的树状 session JSONL**，不另起 `task_*.json` 平行历史。
- 需要的额外字段（userGoal / testCommands / status）通过 `pi.appendEntry(customType, data)` **写进 pi 的 session**，随 fork/resume 一起存活。
- `agent history / resume` **映射到 pi 的 `--resume` / leafId**，不发明 `task_id`。
- task trace 视图 = 从 pi session **投影/索引**出来的只读模型。

---

## 10. Prompt 设计（v1 当成不存在，新增）

- **系统提示结构**：角色 + 工具使用约定 + 安全边界声明 + profile/instructions/memory 注入位。
- **注入机制**：通过 `ResourceLoader.getSystemPrompt / getAppendSystemPrompt`。
- **工具描述**：MCP 工具描述由 adapter 从 MCP server 透传 + 规范化。
- "简短计划""分析失败"等步骤如何被 elicit：写进系统提示模板，并纳入 eval 回归（改 prompt → 看 §5.3 的表）。

---

## 11. 版本规划（rescoped：pi 已有的降级为"复用"，net-new 提前）

| 版本 | 目标 | 内容（★=net-new，○=复用/配置 pi） |
|---|---|---|
| **v0.1** | 跑通 SDK 封装 | ○ `createAgentSession` 薄 CLI + `-p` + AGENTS.md/profile 注入；★ `agent init` 生成 `.agent/` |
| **v0.2** | 安全策略层 | ★ approval-mode 状态机 + 命令分级 + 路径策略 + **对抗性测试**；○ 复用 git-checkpoint 做 undo |
| **v0.3** | 受控 test-fix loop | ★ §7 的预算/终止/防 reward-hacking 守卫；○ 复用 pi 的 bash/编辑/迭代 |
| **v0.4** | **Eval harness** | ★ fixture repo + 自动打分 + 回归表（项目的度量基石） |
| **v0.5** | **MCP adapter** | ★ stdio/JSON-RPC + schema 映射 + GitHub 端到端 demo |
| **v1.0** | 展示版 | 三大支柱齐活 + 一页"pi 给了什么/我加了什么"设计文档 + README 架构图 |

> 说明：v0.1–v0.3 不再宣称"实现了工具/会话/测试循环"，而是"**在 pi 之上配置/约束/度量**它们"。

---

## 12. Demo 设计

planted-bug TS API repo（token 过期返回 500，应为 401）。一条命令展示**全链路**：

```bash
agent "修复登录 token 过期返回 500 的问题（应 401），并补测试"
```

展示点（比 v1 多了三处 net-new）：
1. 搜索/读文件/改 auth middleware/新增测试/跑测试/展示 diff/总结（○ pi 能力）。
2. **安全拦截演示**：故意诱发 `rm -rf` / 写 `.env`，展示策略层阻断（★）。
3. **eval 演示**：`agent eval` 输出"5/6 场景通过"的回归表（★）。
4. **MCP 演示**：`agent "按 GitHub issue #12 修复"` 走 MCP adapter（★）。

---

## 13. 成功指标

**功能**：能定位代码、完成 1 个 bugfix、增/改测试、失败后受控修复、展示 diff、撤销文件改动、基于 pi session 续跑。

**工程**：所有写入经策略层、所有命令经风险分级、单一会话真相源、有错误处理/预算、CLI 不 fork pi（纯 SDK 集成）。

**★ 度量（新增，最关键）**：eval harness 可一键回归，输出跨 model/prompt 的通过率表；安全策略有对抗性测试覆盖。

---

## 14. 面试叙事 & 预设问答（直接写进文档）

- **"pi 已经是 coding agent，你做了什么？"** → 指 §3 对照表：pi 是我的 runtime；我做了安全策略层、MCP 集成、eval 度量、项目记忆——pi 都没有。
- **"为什么不直接用 pi / 写三个扩展？"** → 子命令 + `-p` 策略 + 模式切换需要进程入口，扩展做不到，所以走 SDK（`createAgentSession`）；fork 则要背 pi 的维护成本，没有收益。
- **"安全怎么防 bash 绕过？"** → §5.1 威胁模型:策略分级（减速带）+ 可选 sandbox-runtime（OS 级真边界），并诚实区分两者。
- **"test-loop 不用 LangGraph 怎么控？"** → §7:loop 是 pi 的，**守卫是我的**（预算/无进展检测/防 reward-hacking/失败保全）。
- **"怎么证明它有效？"** → §5.3 eval harness（不是单个 demo）。
- **"最难的工程点？"** → MCP 的 JSONSchema→TypeBox 映射 + server 崩溃不卡死 loop；或审批模式与 pi 并行工具执行的交互（deny 要在 mutation queue 落盘前短路）。

---

## 15. 结论

> 本项目不是"又造了一个 coding agent"。它是**把 pi 这个商用级 harness 当 runtime，补齐一个团队要把 agent 真正交付上线所必需的集成、策略与度量**——这正是 agent 开发岗的日常工作。可辩护、可演示、可度量，且每一处新增都能说清"pi 给了什么、我加了什么"。
