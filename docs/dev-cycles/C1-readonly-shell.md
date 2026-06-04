# Cycle C1:v0.1 — SDK 外壳与只读理解(预计 6 天 · 周期 2/7)

## 1. 周期目标

本周期结束时,Agent CLI 已是一个独立可执行文件,通过 pi SDK 在进程内拉起一个 `createAgentSession`,并能以**只读**方式理解项目、搜索代码、回答问题:支持顶层 `agent "<自然语言>"`(交互 TUI)与 `agent -p "<prompt>"`(driver 自管 print 循环,语义对齐 pi print 模式的非交互语义),以及 `agent init`(探测并生成 `.agent/` 骨架)、`agent ask`(只读问答)子命令。系统提示按 profile / AGENTS.md / memory 三路注入。之所以把"只读外壳"放在 C0(基建)之后、安全策略(C2)之前,是因为它定义了后续所有周期都要挂载的三个接缝——session 工厂、resource loader 的 `extensionFactories` 管道、双驱动 driver——把这些接缝先用空工厂占好位,C2 起只需往管道里塞策略/MCP/trace/守卫,不再动外壳。本周期通过 `computeTools(readonly)` 物理只给 `read/grep/find/ls`,在没有任何策略代码的情况下用工具白名单实现"硬只读",这本身就是 C2 安全论证的第一块基石。

## 2. 范围

### 2.1 In-scope(本周期做)

- `src/runtime/session-factory.ts`:`computeTools(mode)` + `buildSession(opts)`,封装 `createAgentSession`,以 `tools` 白名单做硬隔离(readonly 只给 `read/grep/find/ls`),`sessionManager` 设为 pi 的单一真相源,`settingsManager` 开启 retry。
- `src/runtime/resource-loader.ts`:`buildResourceLoader(ctx)` 构造 `DefaultResourceLoader`,挂上 `extensionFactories` 管道(本周期工厂列表为空数组,占位),并经 `appendSystemPrompt` / `appendSystemPromptOverride` 注入 profile + memory 文本;AGENTS.md 复用 pi 原生加载。
- `src/runtime/driver.ts`:`drive(session, opts)` 两种驱动——交互(转交 pi TUI runtime)与 print(`-p`,driver 自管 `session.subscribe` + `session.prompt` 的 print 循环,语义对齐 pi print 模式的 `mode:"text"` 事件流;不直接调 `runPrintMode`)。
- `src/context/profile.ts`:`detectProfile(cwd)` 探测 stack/包管理器/测试框架/源目录/命令,持久化到 `.agent/project-profile.json`;`loadProfile` / `renderProfileForPrompt`。
- `src/cli/`:`args.ts`(commander 定义)+ 子命令 `init.ts`、`ask.ts`;顶层 `agent <自然语言>` 默认入口 + 全局 `-p/--print` flag。
- `agent init`:探测 profile → 写 `.agent/project-profile.json` + `.agent/memory.md` 骨架(空 policy.json 占位,字段不解释,留给 C2)。
- `src/context/memory.ts` 的**读取**部分:`loadMemory(cwd)` 读 `.agent/memory.md` 供注入(写入/`remember` 工具留到后续周期)。

### 2.2 Out-of-scope(明确推迟)

- 安全策略引擎 `policy/`(engine/gateway/command-classifier/path-guard)、approval-mode 状态机、对抗性测试 → **C2**。本周期 `.agent/policy.json` 只写空骨架,不被消费。
- 写文件 / 编辑 / bash 工具的放行(suggest / workspace-write / auto 模式)→ **C2**。本周期只跑 readonly。
- `loop/guards.ts` 控制流守卫、`trace/`(entries/projection)、`agent diff` / `agent undo` → **C3**。
- eval harness `eval/` → **C4**。
- MCP adapter `mcp/` 与 `agent mcp add` → **C5**。
- `agent review`、`agent history` / `agent resume` 的完整实现 → 随 C3/后续。本周期 `review` 可不注册或仅占位。
- `context/memory.ts` 的写入与自研 `remember` 工具 → 后续(C3 及以后)。

## 3. 前置依赖

- **C0 产出**:仓库脚手架(`package.json` 依赖 `@earendil-works/{pi-coding-agent,pi-ai,pi-tui}` + `typebox` + `commander`)、tsconfig、测试框架与 CI、pi faux provider 测试夹具的可用性(`registerFauxProvider` + 套件 harness 模式已可被本仓库 import 或复刻)。
- **pi SDK 接口**(已是真实 API,无需 C0 之外的额外产出):`createAgentSession` / `DefaultResourceLoader` / `getAgentDir` / `SessionManager.create`/`inMemory` / `SettingsManager.inMemory` / `getModel`(来自 `@earendil-works/pi-ai`)/ `runPrintMode`(本周期 driver 自管 print 循环、不直接调用;若要复用需先经 `createAgentSessionRuntime` 构造 AgentSessionRuntime host,其首参非裸 session)/ `createReadOnlyTools`(确认其内部即 `read/grep/find/ls`)。
- **外部条件**:交互/真跑需要至少一个 provider key(如 `ANTHROPIC_API_KEY`,经 pi `AuthStorage` 或 `authStorage.setRuntimeApiKey`);单测/集成不需要 key,用 pi 的 faux provider 跑 headless session。

## 4. 工作分解 WBS

| 任务 | 涉及文件/模块 | 说明 | 估时 |
|---|---|---|---|
| T1.1 commander 骨架与 dispatch | `src/main.ts`、`src/cli/args.ts` | 定义顶层 `agent <task...>`、全局 `-p/--print`、`--cwd`、`--model`;注册 `init`/`ask` 子命令;无子命令且有位置参数时走默认 run(只读问答)。parseArgs → `{ subcommand, cwd, approvalMode:"readonly", prompt, printMode, model }` | 0.5d |
| T1.2 profile 探测 | `src/context/profile.ts` | `detectProfile(cwd)`:读 `package.json`/`pyproject.toml`/`go.mod`;由 lockfile(`pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`)定包管理器;扫描 `src`/`test` 目录;从 `scripts` 解析 test/lint/build 命令。返回 `ProjectProfile`(§5) | 1d |
| T1.3 profile 持久化 + 渲染 | `src/context/profile.ts` | `saveProfile(cwd, p)` 写 `.agent/project-profile.json`;`loadProfile(cwd)`;`renderProfileForPrompt(p)` → 注入用文本块 | 0.5d |
| T1.4 memory 读取 | `src/context/memory.ts` | `loadMemory(cwd)` 读 `.agent/memory.md`(不存在返回空);`renderMemoryForPrompt` | 0.25d |
| T1.5 resource-loader 注入 | `src/runtime/resource-loader.ts` | `buildResourceLoader(ctx)`:`new DefaultResourceLoader({ cwd, agentDir:getAgentDir(), extensionFactories:[] /*占位*/, appendSystemPromptOverride })`;把 profile+memory 渲染文本经 `appendSystemPrompt` 注入;`await rl.reload()`。AGENTS.md 走 pi 原生 | 1d |
| T1.6 session 工厂 | `src/runtime/session-factory.ts` | `computeTools(mode)`(readonly→`["read","grep","find","ls"]`);`buildSession(opts)` 调 `createAgentSession({ cwd, model, tools, resourceLoader, sessionManager:SessionManager.create(cwd), settingsManager:SettingsManager.inMemory({retry}) })`;`opts.model?: Model` 为可注入模型接缝(faux.getModel() 返回 Model 对象,优先于 `modelId`,供 §6/§7 faux 测试注入) | 1d |
| T1.7 driver 双驱动 | `src/runtime/driver.ts` | print:`session.subscribe` 收 `message_update`/`text_delta` 写 stdout,`await session.prompt(prompt)`,`finally session.dispose()`(driver 自管 print 循环,语义对齐 pi print 模式 text;不直接调 `runPrintMode`,如需复用其首参为 `createAgentSessionRuntime` 构造的 host 而非裸 session);interactive:转交 pi TUI runtime | 1d |
| T1.8 `agent init` | `src/cli/commands/init.ts` | 调 detectProfile → saveProfile;写 `.agent/memory.md` 骨架 + 空 `.agent/policy.json` 占位(不解释字段);幂等(已存在则提示并 `--force` 覆盖) | 0.5d |
| T1.9 `agent ask` / 默认 run | `src/cli/commands/ask.ts` | 构造 readonly context → buildResourceLoader → `const { session, modelFallbackMessage } = await buildSession(...)`(解构 CreateAgentSessionResult)→ drive(session, ...);支持 `-p` 与 stdin 管道(`cat x | agent -p "..."`) | 0.5d |
| T1.10 收尾:--help 文案、错误兜底、单测/集成补全 | 全部 | `--help` 标注本版仅 readonly;无 model/无 key 的友好报错(复用 pi `modelFallbackMessage`) | 0.5d |

任务编号 T1.<n> 即 T<cycle>.<n>(cycle=1,周期 2/7 的版本号 v0.1)。

## 5. 关键接口 / 数据结构

```ts
// src/policy/types.ts —— 本周期只用到 ApprovalMode 的 "readonly";其余值由 C2 消费
export type ApprovalMode = "readonly" | "suggest" | "workspace-write" | "auto";

// src/context/profile.ts
export interface ProjectProfile {
  language: string;            // "typescript" | "python" | "go" | ...
  packageManager: string;      // "pnpm" | "npm" | "yarn" | "pip" | "go" ...
  framework?: string;
  testFramework?: string;
  sourceDirs: string[];
  testDirs: string[];
  commands: { test?: string; lint?: string; build?: string };
}
export function detectProfile(cwd: string): Promise<ProjectProfile>;
export function saveProfile(cwd: string, p: ProjectProfile): void;   // 写 .agent/project-profile.json
export function loadProfile(cwd: string): ProjectProfile | undefined;
export function renderProfileForPrompt(p: ProjectProfile): string;

// src/context/memory.ts(本周期只读)
export function loadMemory(cwd: string): string;                     // 读 .agent/memory.md
export function renderMemoryForPrompt(md: string): string;

// 本周期内部上下文对象(C2 起会补 policy/mcpConfig 字段)
export interface ProjectContext {
  cwd: string;
  mode: ApprovalMode;          // 本周期固定 "readonly"
  profile?: ProjectProfile;
  memory: string;
}
```

```ts
// src/runtime/session-factory.ts —— 真实 pi API
import { createAgentSession, SessionManager, SettingsManager,
         type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { getModel, type Model } from "@earendil-works/pi-ai";

export function computeTools(mode: ApprovalMode): string[] {
  const base = ["read", "grep", "find", "ls"];          // 与 pi createReadOnlyTools 一致
  if (mode === "readonly") return base;                  // 硬隔离:物理不给写/执行工具
  return [...base, "edit", "write", "bash"];             // C2 才会走到这里
}

export async function buildSession(opts: {
  cwd: string; mode: ApprovalMode; resourceLoader: ResourceLoader; modelId?: string; model?: Model;
}) {
  const model = opts.model ?? getModel("anthropic", opts.modelId ?? "claude-sonnet-4-6");
  return createAgentSession({
    cwd: opts.cwd,
    model,
    tools: computeTools(opts.mode),                       // ★ 白名单即唯一只读边界
    resourceLoader: opts.resourceLoader,
    sessionManager: SessionManager.create(opts.cwd),      // ★ pi session = 单一真相源
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: true, maxRetries: 2 },            // API 限流/5xx 委托 pi
    }),
  });   // 返回完整 CreateAgentSessionResult { session, extensionsResult, modelFallbackMessage };调用方需解构出 session 再传给 drive
}
```

```ts
// src/runtime/resource-loader.ts —— extensionFactories 管道占位 + 系统提示注入
import { DefaultResourceLoader, getAgentDir,
         type ExtensionFactory } from "@earendil-works/pi-coding-agent";

export function buildResourceLoader(ctx: ProjectContext, opts?: { extraFactories?: ExtensionFactory[] }): DefaultResourceLoader {
  const factories: ExtensionFactory[] = [...(opts?.extraFactories ?? [])];   // ★ 占位:C2 policyGateway、C3 trace/guards、C5 mcpAdapter 都往这塞
  const injected = [
    ctx.profile ? renderProfileForPrompt(ctx.profile) : "",
    ctx.memory ? renderMemoryForPrompt(ctx.memory) : "",
  ].filter(Boolean);
  return new DefaultResourceLoader({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    extensionFactories: factories,
    // profile/memory 是上下文 → 走 append system prompt(AGENTS.md 由 pi 原生加载)
    appendSystemPromptOverride: (base: string[]) => [...base, ...injected],
  });
  // 调用方负责 await loader.reload()
}
```

```ts
// src/runtime/driver.ts —— driver 自管 session.subscribe + session.prompt 的 print 循环,语义对齐 pi print 模式;
// 若要直接复用 runPrintMode,需先构造 AgentSessionRuntime host(createAgentSessionRuntime),其首参非裸 session。
export async function drive(session, opts: { printMode: boolean; prompt: string; onUsage?: (u: TokenUsage) => void }) {
  if (opts.printMode) {
    session.subscribe((e) => {
      if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta")
        process.stdout.write(e.assistantMessageEvent.delta);
      // onUsage:从 agent_end 末条 assistant 消息透出 usage,供 C3 token 软停 / C6 复用
      if (e.type === "agent_end" && opts.onUsage) {
        const last = e.messages[e.messages.length - 1];
        if (last?.role === "assistant") opts.onUsage(last.usage);
      }
    });
    await session.prompt(opts.prompt);
    session.dispose();
    return;
  }
  // 交互:转交 pi 的 TUI runtime
}
```

> 注:`buildSession` 返回完整 `CreateAgentSessionResult`(`{ session, extensionsResult, modelFallbackMessage }`),调用方须先解构出 `session` 再传给 `drive`;`drive` 的 `onUsage` 是为 C3 token 软停 / C6 预留的用量回调接缝(overview §3.1),本周期不消费。

```jsonc
// .agent/project-profile.json(init 产物示例)
{
  "language": "typescript",
  "packageManager": "pnpm",
  "framework": "hono",
  "testFramework": "vitest",
  "sourceDirs": ["src"],
  "testDirs": ["test"],
  "commands": { "test": "pnpm test", "lint": "pnpm lint", "build": "pnpm build" }
}
```

## 6. 验收标准

- [ ] `agent init` 在一个 TS 仓库内运行后,生成 `.agent/project-profile.json`,其中 `packageManager` 与 `commands.test` 与该仓库实际配置一致(可对真实 fixture 仓断言)。
- [ ] `agent init` 同时生成 `.agent/memory.md` 骨架与空 `.agent/policy.json` 占位;重复运行不报错(幂等),`--force` 才覆盖。
- [ ] `computeTools("readonly")` 严格返回 `["read","grep","find","ls"]`,不含 `edit/write/bash`(单测断言)。
- [ ] 用 faux provider 跑一个 readonly headless session,模型若发起 `write`/`bash` 工具调用,因不在白名单内而**无法执行**(pi 层拒绝/无此工具),session 不写任何文件(运行前后对 cwd 做 git status diff 为空)。
- [ ] `agent -p "用一句话说明这个项目是做什么的"` 在 fixture 仓上能产出非空文本到 stdout 并以退出码 0 结束(可用 faux provider 喂确定性回答)。
- [ ] `cat some.log | agent -p "解释这个错误"` 能把 stdin 内容纳入 prompt 并产出回答。
- [ ] 系统提示中可观测到 profile 与 memory 的注入内容(通过 `loader.getAppendSystemPrompt()` 断言包含 `renderProfileForPrompt` 的关键字段,如包管理器、测试命令)。
- [ ] AGENTS.md 若存在于仓库根,其内容经 pi 原生加载进入上下文(`loader.getAgentsFiles()` 含该文件)。
- [ ] 无可用 model / 无 key 时,CLI 给出可读报错(透出 pi 的 `modelFallbackMessage`),不抛未捕获异常。
- [ ] `agent --help` 明确标注 v0.1 仅 readonly,不写文件、不执行命令。

## 7. 测试计划

- **单测(纯函数,不碰 LLM)**:
  - `computeTools`:readonly 与非 readonly 两分支返回值断言。
  - `detectProfile`:对若干 fixture 目录(pnpm-TS、npm-TS、python-pyproject、go-mod)断言 packageManager / commands / sourceDirs。
  - `renderProfileForPrompt` / `renderMemoryForPrompt`:输出包含关键字段,空输入返回空串。
  - `saveProfile`/`loadProfile`:round-trip 一致。
- **集成(pi faux provider 跑 headless session)**:
  - 用 `registerFauxProvider` + 套件 harness 模式构造确定性 provider,经 `buildResourceLoader` + `buildSession(readonly)` 起 session(faux 模型经 `buildSession` 的 `opts.model` 注入,即 `faux.getModel()`);喂一个会发起 `write`/`bash` 的脚本化回答——脚本化工具回合须用 `fauxAssistantMessage(fauxToolCall("write"|"bash", argsObj))` 包装后 `setResponses([...])`;直接传 `fauxText`/`fauxToolCall`(内容块)会类型出错——断言:文件系统无变更、session 正常 `agent_end`。
  - print 驱动:`drive(session,{printMode:true})` 断言 stdout 收到 `text_delta` 拼接出的完整文本,且 `session.dispose()` 被调用。
  - 注入回归:断言 `loader.getAppendSystemPrompt()` 含 profile/memory 文本,`getAgentsFiles()` 含 AGENTS.md。
- **对抗性**:本周期不做完整对抗套件(属 C2)。仅保留一条最小用例:readonly 下模型请求 `bash("rm -rf .")` 因工具不在白名单而无法发起,作为 C2 对抗套件的起点。
- **eval**:本周期不涉及(C4)。

## 8. 风险与缓解

- **风险:`appendSystemPrompt` vs `appendSystemPromptOverride` 语义差异导致注入位置不对。** 缓解:以 pi 源码 `DefaultResourceLoaderOptions` 为准——两者并存,用 `appendSystemPromptOverride(base)=>[...base,...injected]` 保证追加而非替换;集成测试断言 `getAppendSystemPrompt()` 既保留 pi 基础项又含注入项。
- **风险:profile 探测对多语言/monorepo 误判(技术文档 §7 留白)。** 缓解:本周期只覆盖单仓 TS/Python/Go 主路径,monorepo / workspaces 标注为已知限制写进 `--help` 与 memory;探测失败时写最小 profile(仅 language)而非崩溃。
- **风险:readonly 的"硬隔离"是否真的物理拦截,而非仅靠提示词。** 缓解:依据 pi `createAgentSession` 的 `tools`/`initialActiveToolNames` 机制——未列入白名单的工具不进入 active 集合;集成用例直接验证模型发起越权工具时无效果。这条同时是 C2 安全论证(§5.1 readonly 行)的预埋证据。
- **风险:`-p` 非交互下需要确认的操作无 UI(技术文档 §15-1 / §4.2 的 `ctx.hasUI` 问题)。** 本周期 readonly 不产生任何 confirm/deny,风险不触发;但 driver 在 print 路径下不假设有 UI,为 C2 的"无 UI 保守阻断"预留接口形状(`drive` 已区分 printMode)。
- **风险:多 agent 同仓并发对 `.agent/` 与 session 的写竞争(技术文档 §15-5)。** 本周期 `init` 为一次性写、运行期 readonly 不写盘,风险低;仅在文档注明跨进程锁/租约留待后续。
- **风险:provider key 缺失阻断演示。** 缓解:演示与 CI 分离——CI 全程 faux provider;真跑演示前用 `agent`(交互)校验 key,失败给明确指引。

## 9. Definition of Done

- [ ] `session-factory.ts` / `resource-loader.ts` / `driver.ts` / `context/profile.ts` / `context/memory.ts`(读) / `cli/args.ts` / `cli/commands/{init,ask}.ts` / `main.ts` 全部落地并通过类型检查。
- [ ] `extensionFactories` 管道已接通(默认空,经 `buildResourceLoader` 的 `opts.extraFactories` 注入——这是文档化的注入接缝),后续周期可零改动外壳地往里追加工厂。
- [ ] 第 6 节验收标准全部勾选通过。
- [ ] 第 7 节单测 + 集成(faux provider)在 CI 绿;覆盖 computeTools / detectProfile / 注入 / readonly 隔离 / print 驱动。
- [ ] `agent --help` 与 README 的 v0.1 段落写明:本版只读,不 fork pi(纯 SDK),策略层在 v0.2。
- [ ] 周期演示命令(第 10 节)在一个真实 fixture 仓上可现场跑通。

## 10. 周期演示

在 fixture 仓 `fixtures/hono-api` 内,依次:

```bash
# 1) 生成 .agent/(探测画像)
agent init
#   预期:打印探测结果(language=typescript, packageManager=pnpm, test=pnpm test),
#   并生成 .agent/project-profile.json / memory.md / 空 policy.json

# 2) 只读问答(交互或 -p)
agent -p "这个项目用什么框架?入口文件在哪?"
#   预期:基于 read/grep/find/ls 给出框架(hono)与入口路径,全程不写盘

# 3) 管道输入
cat build-error.log | agent -p "解释这个报错,可能是哪个文件的问题"
#   预期:结合 stdin 内容定位到相关源文件并解释

# 4) 只读边界可见性(演示安全雏形)
agent -p "删除 src 目录下所有文件"
#   预期:无 write/bash 工具可用,模型无法执行破坏性操作,仅能解释或拒绝;
#         运行前后 git status 无变化
```

## 11. 交付物

- **代码模块**:`src/main.ts`、`src/cli/args.ts`、`src/cli/commands/init.ts`、`src/cli/commands/ask.ts`、`src/runtime/session-factory.ts`、`src/runtime/resource-loader.ts`、`src/runtime/driver.ts`、`src/context/profile.ts`、`src/context/memory.ts`(读取)、`src/policy/types.ts`(仅 `ApprovalMode` 类型,供后续复用)。
- **测试**:`test/unit/compute-tools.test.ts`、`test/unit/profile.test.ts`、`test/integration/readonly-session.test.ts`(faux provider)、`test/integration/print-driver.test.ts`、`test/integration/prompt-injection.test.ts`。
- **fixture**:`fixtures/hono-api`(供 init/ask 演示与集成测试,planted-bug 留到 C4 再补)。
- **文档**:README v0.1 段(架构三层职责草图 + "pi 给了什么 / 我加了什么" 在本周期的对应:pi=loop/工具/会话/print/AGENTS.md,我=外壳 dispatch + profile/memory 注入 + readonly 白名单)。
- **demo 脚本**:`scripts/demo-v0.1.sh`,封装第 10 节四条命令。
