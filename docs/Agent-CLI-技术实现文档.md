# Agent CLI 技术实现文档

> 配套《Agent CLI 需求文档 v2》。本文给出**落地级**设计:进程模型、代码结构、关键接口、核心算法、时序、测试策略。所有 pi 接口均为真实 API(`createAgentSession` / `DefaultResourceLoader` / `pi.on("tool_call")` / `pi.registerTool` / `pi.appendEntry` / `ctx.sessionManager.getBranch()` 等)。
>
> 设计红线:**pi 是库,不 fork;只在 pi 没覆盖的接缝加东西。** 四个新增模块——安全策略层、MCP adapter、eval harness、项目记忆——其余一律复用 pi。

---

## 1. 进程模型与启动时序

Agent CLI 是一个独立可执行文件,在进程内通过 SDK 拉起 pi 的一个 `session`,并把自研逻辑以 **in-process 扩展工厂**(`extensionFactories`)挂到 pi 的事件总线上。

**启动时序(`agent "<task>"`):**

```
main.ts
 1. parseArgs            → { subcommand, cwd, approvalMode, prompt, printMode }
 2. loadProjectContext   → .agent/policy.json + project-profile.json + memory.md (+ pi 的 AGENTS.md)
 3. buildResourceLoader  → DefaultResourceLoader({
                              cwd, agentDir,
                              extensionFactories: [policyGateway, mcpAdapter, traceRecorder, loopGuards],
                              // getSystemPrompt 注入 profile/instructions/memory
                            }); await rl.reload()
 4. computeTools(mode)   → readonly: ["read","grep","find","ls"]
                            其余: ["read","grep","find","ls","edit","write","bash"]
 5. createAgentSession({ cwd, resourceLoader, tools, sessionManager, settingsManager })
 6. drive(session)       → interactive(TUI) | print(-p): session.subscribe + session.prompt
 7. finally session.dispose()
```

**关键点**:审批模式的"硬隔离"在第 4 步(从工具白名单里**物理排除** write/edit/bash),不是靠提示词;第 6 步的两种驱动方式都复用 pi(交互走 TUI 模式,`-p` 复用 `modes/print-mode.ts` 的 `--mode json` 事件流)。

---

## 2. 代码结构

独立仓库,依赖 pi 三个包:

```
agent-cli/
├── package.json            # deps: @earendil-works/{pi-coding-agent,pi-ai,pi-tui}, typebox, commander
├── src/
│   ├── main.ts             # 入口:argparse → 子命令 dispatch
│   ├── cli/
│   │   ├── args.ts         # commander 定义
│   │   └── commands/       # run/ask/review/diff/undo/mcp/eval/init.ts
│   ├── runtime/
│   │   ├── session-factory.ts   # createAgentSession 封装 + computeTools(mode)
│   │   ├── resource-loader.ts    # 系统提示注入(profile/instructions/memory)
│   │   └── driver.ts             # interactive / print 两种驱动
│   ├── policy/             # ★ 安全策略层(§4)
│   │   ├── types.ts        # ApprovalMode / PolicyConfig / Verdict
│   │   ├── engine.ts       # classify(event, mode) → Verdict
│   │   ├── command-classifier.ts
│   │   ├── path-guard.ts
│   │   └── gateway.ts      # extensionFactory: pi.on("tool_call")
│   ├── mcp/                # ★ MCP adapter(§5)
│   │   ├── client.ts       # stdio JSON-RPC 客户端
│   │   ├── schema-map.ts   # JSON Schema → TypeBox
│   │   ├── adapter.ts      # extensionFactory: discovery + registerTool 桥接
│   │   └── config.ts       # .agent/mcp.json
│   ├── eval/               # ★ eval harness(§6)
│   │   ├── harness.ts      # 跑场景
│   │   ├── scoring.ts      # 评分 rubric
│   │   ├── report.ts       # 表格 + 回归 diff
│   │   └── fixtures/       # planted-bug repos + scenarios.json
│   ├── context/           # ★ 项目画像 + 记忆(§7)
│   │   ├── profile.ts
│   │   └── memory.ts
│   ├── trace/             # task 视图(基于 pi session 投影,§8)
│   │   ├── entries.ts
│   │   └── projection.ts
│   └── loop/
│       └── guards.ts       # extensionFactory: test-fix 预算/反作弊(§9)
└── .agent/                 # 每个项目生成:policy.json / project-profile.json / memory.md
```

---

## 3. 集成层(runtime/)

### 3.1 session-factory.ts

```ts
import { createAgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import type { ApprovalMode } from "../policy/types";

const WRITE_TOOLS = ["edit", "write"];
const EXEC_TOOLS = ["bash"];

export function computeTools(mode: ApprovalMode): string[] {
  const base = ["read", "grep", "find", "ls"];
  if (mode === "readonly") return base;              // 硬隔离:不给写/执行工具
  return [...base, ...WRITE_TOOLS, ...EXEC_TOOLS];   // suggest 的"不落盘"在 gateway 拦截
}

export async function buildSession(opts: {
  cwd: string; mode: ApprovalMode; resourceLoader: ResourceLoader;
}) {
  const model = getModel("anthropic", "claude-sonnet-4-6"); // 由 config.model 解析
  return createAgentSession({
    cwd: opts.cwd,
    model,
    tools: computeTools(opts.mode),
    resourceLoader: opts.resourceLoader,
    sessionManager: SessionManager.create(opts.cwd),       // ★ 单一真相源
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: true, maxRetries: 2 },             // 委托 pi 处理 API 限流/5xx
    }),
  });
}
```

### 3.2 resource-loader.ts(系统提示注入)

用 `DefaultResourceLoader` 并挂载扩展工厂;profile/instructions/memory 通过 `additionalExtensionPaths` 不行——它们是**上下文**,走系统提示。两条路:

- 简单:把 profile/memory 渲染成一段文本,塞进 `getAppendSystemPrompt`。
- 干净:复用 pi 的 `AGENTS.md` 加载(pi 原生),`agent init` 时把 profile 摘要写进 `AGENTS.md`,memory 单独 append。

```ts
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { policyGateway } from "../policy/gateway";
import { mcpAdapter } from "../mcp/adapter";
import { traceRecorder } from "../trace/entries";
import { loopGuards } from "../loop/guards";

export function buildResourceLoader(ctx: ProjectContext) {
  return new DefaultResourceLoader({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    extensionFactories: [
      policyGateway(ctx.policy, ctx.mode),
      mcpAdapter(ctx.mcpConfig),
      traceRecorder(ctx.goal, ctx.mode),
      loopGuards(ctx.policy.limits, ctx.profile),
    ],
    // 注:DefaultResourceLoader 会自动加载 .pi/extensions、AGENTS.md 等
  });
}
```

> 每个 `extensionFactory` 是 `(pi: ExtensionAPI) => void`,与磁盘上的扩展同构,只是由我们在进程内显式注入,不依赖发现机制。

### 3.3 driver.ts

```ts
export async function drive(session, opts: { printMode: boolean; prompt: string }) {
  if (opts.printMode) {
    session.subscribe((e) => {
      if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta")
        process.stdout.write(e.assistantMessageEvent.delta);
    });
    await session.prompt(opts.prompt);   // 一次性;复用 pi 非交互语义
    session.dispose();
    return;
  }
  // 交互模式:转交 pi 的 TUI runtime(或我们自管的 readline 循环)
}
```

---

## 4. 安全策略层(policy/)★

### 4.1 类型

```ts
export type ApprovalMode = "readonly" | "suggest" | "workspace-write" | "auto";

export interface PolicyConfig {
  command: { allow: string[]; confirm: string[]; deny: string[] };
  path: { deny: string[]; confirmWrite: string[] };       // glob
  limits: { maxChangedFiles: number; maxFixIterations: number; maxToolCalls: number; tokenBudget?: number };
  sandbox: { enabled: boolean };                           // 接 @anthropic-ai/sandbox-runtime
}

export type Verdict =
  | { kind: "allow" }
  | { kind: "confirm"; reason: string }
  | { kind: "deny"; reason: string };
```

### 4.2 classify 算法(engine.ts)

输入 pi 的 `ToolCallEvent`(`event.toolName`, `event.input`)+ 当前 `mode`:

```
classify(event, mode):
  switch event.toolName:
    read | grep | find | ls:
        return path.deny.matches(target) ? deny("敏感文件读取") : allow   // 读保护可选

    write | edit | apply_patch:
        if mode == readonly: return deny("readonly 模式")                 // 防御性,正常已被工具白名单挡掉
        p = targetPath(event.input)
        if path.deny.matches(p):            return deny("受保护路径: " + p)
        if outsideRepoRoot(p):              return confirm("仓库外写入: " + p)
        if path.confirmWrite.matches(p):    return confirm("敏感配置: " + p)   // package.json/lockfile/CI
        if changedFileCount + 1 > limits.maxChangedFiles: return confirm("超过 N 文件批改")
        if mode == suggest:                 return confirm("suggest 模式:确认后才落盘")
        return allow

    bash:
        if mode == readonly: return deny("readonly 模式")
        tier = commandClassifier.tier(event.input.command)    // allow|confirm|deny
        if tier == deny:    return deny("高危命令: " + reason)
        if bashTouchesProtectedPath(event.input.command): return confirm("命令疑似写敏感路径")  // best-effort
        if tier == confirm: return confirm("需确认命令")
        return allow

    default: return allow
```

**模式与确认的统一收口**(gateway.ts):

```ts
export const policyGateway = (policy: PolicyConfig, mode: ApprovalMode) => (pi: ExtensionAPI) => {
  let changedFiles = 0;
  pi.on("agent_start", () => { changedFiles = 0; });
  pi.on("tool_call", async (event, ctx) => {
    const v = classify(event, mode, policy, changedFiles);
    if (v.kind === "deny")    return { block: true, reason: v.reason };
    if (v.kind === "confirm") {
      if (mode === "auto") {
        // auto 不弹窗,但 deny 已在上面硬生效;confirm 在 auto 下放行(deny≠放飞)
      } else {
        if (!ctx.hasUI) return { block: true, reason: v.reason + "(无 UI,保守阻断)" };  // -p 模式
        const ok = await ctx.ui.confirm("高风险操作", v.reason);
        if (!ok) return { block: true, reason: "用户拒绝" };
      }
    }
    if (event.toolName === "write" || event.toolName === "edit") changedFiles++;
    return undefined;  // 放行
  });
};
```

### 4.3 两个必须讲清的设计点

**① 阻断在落盘之前发生。** pi 的 agent-loop 在执行工具前先触发 `tool_call`,返回 `{block:true}` 即短路,**永不进入工具的 `execute`**,而 `file-mutation-queue` 在 `execute` 内部——所以 deny 一定在任何文件写入之前生效,无竞态。(证据:`agent-loop.ts` 的 `beforeResult.block` 分支;`tools/file-mutation-queue.ts`。)

**② bash 威胁模型(诚实表述)。** 路径黑名单挡不住 `cat ~/.ssh/id_rsa`、`> .env`。`bashTouchesProtectedPath` 是**字符串级 best-effort**(解析重定向 `>`/`>>`/`tee`、参数路径),定位为**减速带**,不号称安全边界。真边界由 `policy.sandbox.enabled` 接 pi 的 `@anthropic-ai/sandbox-runtime` 扩展做 OS 级 `denyRead/denyWrite`(仅 macOS/Linux)。文档与 `--help` 都明示这一区分。

**③ suggest 模式的"不落盘"实现。** 两种,选其一:
- **A(推荐,简单)**:suggest 下 `edit/write` 仍在工具白名单,但 gateway 把它们判为 `confirm`;确认前不写。配合 `agent diff` 展示拟改动。
- **B(更纯)**:suggest 下从白名单排除 `edit/write`,注册一个自研 `propose_patch` 工具,计算并返回 unified diff(`details` 带 patch),由 `agent apply` 人工落盘。B 把"建议"与"应用"彻底解耦,演示效果更好,代价是多一个工具。

---

## 5. MCP Adapter(mcp/)★

### 5.1 客户端(client.ts)

stdio + JSON-RPC 2.0。按 `mcp.json` 启动子进程,`initialize` → `tools/list` → 按需 `tools/call`。

```ts
export class McpClient {
  constructor(private cfg: { command: string; args: string[]; env?: Record<string,string> }) {}
  async start(): Promise<void> { /* spawn; 建立 framing; initialize 握手 */ }
  async listTools(): Promise<McpToolDef[]> { /* tools/list */ }
  async callTool(name: string, args: unknown, signal: AbortSignal): Promise<McpResult> { /* tools/call,signal 取消 */ }
  onCrash(cb: () => void): void {}     // 子进程退出 → 标记不可用 + 退避重启
  dispose(): void {}
}
```

### 5.2 Schema 映射(schema-map.ts)

MCP 工具的 `inputSchema`(JSON Schema)→ pi 的 TypeBox。**诚实标注子集支持**:

```ts
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export function toTypeBox(s: JsonSchema): TSchema {
  switch (s.type) {
    case "string": return s.enum ? StringEnum(s.enum as string[]) : Type.String();
    case "number": return Type.Number();
    case "integer": return Type.Integer();
    case "boolean": return Type.Boolean();
    case "array": return Type.Array(toTypeBox(s.items ?? { type: "string" }));
    case "object": {
      const props = Object.fromEntries(
        Object.entries(s.properties ?? {}).map(([k, v]) => {
          const t = toTypeBox(v);
          return [k, (s.required ?? []).includes(k) ? t : Type.Optional(t)];
        }),
      );
      return Type.Object(props);
    }
    default: return Type.Unknown();   // oneOf/anyOf/$ref/递归 → 宽松透传 + 运行时校验
  }
}
```

策略:`strict: false`(默认)对无法映射的工具用 `Type.Unknown()` 透传并 `ctx.ui.notify` 告警;`strict: true` 时**跳过**该工具并记录,不假装"已解决"。

### 5.3 桥接(adapter.ts,extensionFactory)

```ts
import { truncateTail } from "@earendil-works/pi-coding-agent";

export const mcpAdapter = (cfgs: McpServerConfig[]) => (pi: ExtensionAPI) => {
  const clients: McpClient[] = [];
  pi.on("session_start", async () => {
    for (const cfg of cfgs) {
      const client = new McpClient(cfg); clients.push(client);
      await client.start();
      client.onCrash(() => pi.setActiveTools(pi.getActiveTools().filter(n => !n.startsWith(`mcp__${cfg.name}__`))));
      for (const tool of await client.listTools()) {
        pi.registerTool({
          name: `mcp__${cfg.name}__${tool.name}`,
          label: `MCP: ${tool.name}`,
          description: tool.description,
          parameters: toTypeBox(tool.inputSchema),
          async execute(_id, params, signal) {
            const res = await client.callTool(tool.name, params, signal);
            const text = res.content.filter(c => c.type === "text").map(c => c.text).join("\n");
            return { content: [{ type: "text", text: truncateTail(text, 8_000).text }], details: { mcp: res } };
          },
        });
      }
    }
  });
  pi.on("session_shutdown", () => clients.forEach(c => c.dispose()));
};
```

**要点**:工具名加 `mcp__<server>__` 前缀避免冲突;大输出复用 pi 的 `truncateTail`;`signal` 透传支持取消;server 崩溃用 `setActiveTools` 摘掉对应工具,不卡死 loop。

### 5.4 Demo 路径

`agent mcp add github`(写 `.agent/mcp.json`)→ `agent "按 GitHub issue #12 修复"`:adapter 发现 `github__get_issue` 等工具 → agent 读 issue → 改代码(经 §4 gateway)→ 跑测试 → `github__create_pr_comment` 生成 PR summary。

---

## 6. Eval Harness(eval/)★

> 这是把项目从"演示"抬到"工程"的核心,也是面试最高信号。

### 6.1 场景格式(fixtures/scenarios.json)

```jsonc
[{
  "id": "expired-token-401",
  "repo": "fixtures/hono-api",            // 含 planted bug 的快照
  "prompt": "修复登录 token 过期返回 500 的问题,应返回 401,并补测试",
  "mode": "workspace-write",
  "checks": {
    "bugLocated":  { "grep": "src/middleware/auth\\.ts" },
    "testsPass":   { "cmd": "pnpm test" },
    "diffTouches": { "globs": ["src/middleware/**", "**/*.test.ts"] },
    "addedTest":   { "grep": "401" },
    "inBounds":    true                    // 未触发 deny / 未越权
  }
}]
```

### 6.2 Runner(harness.ts)

```
for scenario in scenarios:
  tmp = copyFixtureToTemp(scenario.repo)
  session = buildSession({ cwd: tmp, mode: scenario.mode, provider })   // headless,复用 §3
  capture deny/confirm 事件(经 policy gateway 的 hook 计数)
  await session.prompt(scenario.prompt)
  await waitFor("agent_end")
  result = scoring.run(scenario.checks, tmp)
  record(model, scenario.id, result)
report.render(records, previousRun)
```

`provider`:CI 用 pi 的**录制式假 provider**(`test/suite/harness.ts` 的 faux provider 模式)做确定性回归;真跑用真实 provider。

### 6.3 评分(scoring.ts)与报告(report.ts)

每个 check 输出 `{pass, reason}`;场景 pass = 全部硬 check 通过。报告是 **model × scenario** 矩阵 + 与上一次 run 的 **回归 diff**(谁从 pass 变 fail)。回归基线存 `.agent/eval/baseline.json`。

```
              expired-token-401   null-deref   sql-injection
sonnet-4-6          PASS             PASS          FAIL(-)      ← 相比基线退化
opus-4-8            PASS             PASS          PASS
```

---

## 7. 项目画像与记忆(context/)★

```ts
// profile.ts:探测并持久化 pi 不存的结构化画像
export interface ProjectProfile {
  language: string; packageManager: string; framework?: string;
  testFramework?: string; sourceDirs: string[]; testDirs: string[];
  commands: { test?: string; lint?: string; build?: string };
}
export async function detectProfile(cwd: string): Promise<ProjectProfile> {
  // 读 package.json/pyproject.toml/go.mod;探测 lockfile 定包管理器;扫描 test 目录
}
```

`memory.md`:跨会话长期记忆(pi 只有单会话)。`agent init` 生成骨架;agent 可经一个自研 `remember` 工具 append。两者在 `getAppendSystemPrompt` 注入,与 pi 的 `AGENTS.md` 并存(优先级见 §10)。

---

## 8. 持久化与 Task Trace(trace/)★

**单一真相源 = pi 的树状 session JSONL。** 不另起 `task_*.json`。

```ts
// entries.ts:把 pi 没有的元数据写进 pi 的 session
export const traceRecorder = (goal: string, mode: string) => (pi: ExtensionAPI) => {
  pi.on("agent_start", () => pi.appendEntry("task-meta", { goal, mode, startedAt: nowIso() }));
  pi.on("agent_end", (e) => pi.appendEntry("task-result", { status: "done", turns: e.messages.length }));
  // tool 调用 / 结果 / 改动文件已在 pi 原生 entry 里,无需重复记录
};
```

```ts
// projection.ts:从 pi session 投影出只读 task 视图
export function projectTask(ctx: ExtensionContext): TaskView {
  const entries = ctx.sessionManager.getBranch();   // 当前分支,天然支持 fork/resume
  return {
    goal: pick(entries, "task-meta")?.goal,
    toolCalls: entries.filter(isToolCall).map(toToolCallView),
    modifiedFiles: dedupe(entries.filter(isEdit).map(p => p.path)),
    result: pick(entries, "task-result"),
  };
}
```

- `agent history` = 列 pi 的 sessions(按 cwd);
- `agent resume [id]` = 映射到 pi 的 `--resume` / leafId,**不发明 task_id**;
- `agent diff` / `agent undo` = 复用 pi 的 edit-diff 渲染 + git-checkpoint(`git stash` 快照),undo **只撤文件**,命令副作用不在范围(明示)。

---

## 9. 控制流与预算(loop/guards.ts)★

> "不用 LangGraph":循环本身是 pi 的 agent loop;**守卫是我的**。一个扩展工厂搞定。

```ts
export const loopGuards = (limits: Limits, profile: ProjectProfile) => (pi: ExtensionAPI) => {
  let toolCalls = 0, fixRounds = 0; const failedSig = new Set<string>();
  pi.on("agent_start", () => { toolCalls = 0; });

  pi.on("tool_call", async (event) => {
    // ① 调用预算
    if (++toolCalls > limits.maxToolCalls)
      return { block: true, reason: `超出工具调用预算(${limits.maxToolCalls}),已停止并产出现状` };

    // ② 反作弊:修测试任务里禁止改测试文件
    if ((event.toolName === "edit" || event.toolName === "write") && isTestFile(targetPath(event.input), profile))
      return { block: true, reason: "检测到改动测试文件以骗过测试,已阻断(reward-hacking guard)" };

    return undefined;
  });

  // ③ 无进展检测:同一组失败连续两轮 → 停
  pi.on("tool_result", (e) => {
    if (isTestRun(e)) {
      const sig = hashFailures(e.output);
      if (failedSig.has(sig) && ++fixRounds >= limits.maxFixIterations)
        pi.sendMessage({ content: "测试反复失败且无进展,停止修复,产出 diff 与失败摘要交人。", customType: "loop-guard" }, { deliverAs: "followUp", triggerTurn: true });
      failedSig.add(sig);
    }
  });
};
```

- **预算**:`maxToolCalls` / `maxFixIterations`;token 预算从 `session.subscribe` 的 usage 事件累计,超限同样停。
- **失败保全**:停止时不回滚,保留 diff + 失败摘要(`git-checkpoint` 保证可回溯)。
- **防作弊**:`isTestFile` 用 `profile.testDirs` + glob 判定。

---

## 10. 配置与优先级

```
.agent/
├── policy.json            # §4 安全/审批 + limits + sandbox
├── project-profile.json   # §7 探测画像
└── memory.md              # §7 跨会话记忆
```

**优先级(高→低)**:CLI flag > `.agent/policy.json` > pi 默认。
**与 pi 不重复**:项目约定复用 pi 的 `AGENTS.md`(不再造 instructions.md);模型/重试等复用 pi 的 settings,只在 `.agent/` 放 pi 确实没有的(策略、画像、记忆)。

---

## 11. 错误处理(委托 vs 自管)

| 失败 | 归属 | 处理 |
|---|---|---|
| API 限流/5xx/超时 | pi | `SettingsManager` retry |
| 畸形 tool args | pi | 工具 schema 校验 / `prepareArguments` |
| 大输出爆上下文 | pi | `truncateHead/Tail` / OutputAccumulator |
| Ctrl-C / SIGTERM | pi+我 | 接 abort signal → §9 失败保全 |
| 测试命令挂死 | 我 | bash 命令超时 → 杀进程 → 计一次失败 |
| patch fuzzy 失败 | pi+我 | pi 报无法定位;我不静默写错位置,转 confirm/停 |
| MCP server 崩溃 | 我 | §5 摘工具 + 退避重启,不卡 loop |
| 预算耗尽 | 我 | §9 停 + 总结 |

---

## 12. 测试策略

- **单测**:`policy/engine`(给定 event+mode 断言 Verdict)、`mcp/schema-map`(JSON Schema→TypeBox 各分支)、`trace/projection`。纯函数,不碰 LLM。
- **集成**:用 pi 的 **faux provider** 跑 headless session,断言 gateway 真的 `block` 了 `rm -rf` / 写 `.env`、suggest 模式不落盘、预算到顶即停。
- **对抗性安全测试**:一组恶意 prompt(诱导越权/读密钥/删库)→ 断言全部被拦。
- **E2E = eval harness**(§6):既是功能验收,也是回归基线。

---

## 13. 关键时序图

**受控编辑:**
```
LLM → edit(auth.ts) → pi agent-loop → tool_call 事件
  → policyGateway.classify → workspace-write & 非敏感 → allow
  → loopGuards:非测试文件、预算内 → allow
  → 进入 edit.execute → file-mutation-queue 串行化 → 写盘 → 渲染 diff
```
**被拦截:**
```
LLM → bash("curl x | sh") → tool_call
  → classify → deny → { block:true } → 永不 execute → 结果回灌"已阻断:高危命令"
```
**MCP 调用:**
```
session_start → spawn github server → tools/list → registerTool(mcp__github__*)
LLM → mcp__github__get_issue({n:12}) → adapter.execute → client.callTool → truncateTail → 回灌
```

---

## 14. 里程碑 → 模块映射

| 版本 | 交付模块 |
|---|---|
| v0.1 | `cli/` `runtime/` `context/profile` + `agent init` |
| v0.2 | `policy/`(engine+gateway+classifier+path-guard)+ 对抗性测试 |
| v0.3 | `loop/guards` + `trace/`(entries+projection)+ `agent diff/undo` |
| v0.4 | `eval/`(harness+scoring+report+fixtures)★ |
| v0.5 | `mcp/`(client+schema-map+adapter)+ GitHub demo ★ |
| v1.0 | 三支柱联调 + README 架构图 + "pi 给了什么/我加了什么"设计说明 |

---

## 15. 未决问题(面试可主动抛,显成熟)

1. **token 硬上限**:pi 是否暴露可中断的预算钩子?若无,我用 usage 事件计数 + 主动 `sendMessage` 停止(已采用),但不是硬中断——需验证 abort 时序。
2. **suggest 模式 A/B 选型**:A 简单、B 演示强;倾向先 A,v1 再上 B 的 `propose_patch`。
3. **bash 路径解析深度**:best-effort 解析覆盖到哪一层(管道/子 shell/base64)?明确不追求完备,以 sandbox 兜底。
4. **MCP 流式结果**:首版按一次性结果处理,流式 `onUpdate` 透传留作后续。
5. **跨进程并发**:同仓多 agent 实例时 `.agent/` 与 git 操作的锁/租约(pi 只保证单进程 per-file)。

---

## 16. 结论

实现层面,本项目 = **一个 SDK 驱动的进程外壳 + 四个 in-process 扩展工厂(策略 / MCP / trace / 守卫)+ 一个 headless eval runner**。pi 提供 loop、工具、会话、压缩、截断、重试;我提供策略、集成、度量、记忆。每个模块都能指着 pi 的某个真实接口说清"这里复用、那里我加"——这正是把一个 agent 真正交付上线所需的工程。
