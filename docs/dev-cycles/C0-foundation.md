# Cycle C0:项目基建与测试地基(预计 7 天 · 周期 1/7)

## 1. 周期目标

本周期结束时,`agent-cli` 是一个能装、能 build、能在 CI 里跑测试的独立 TypeScript 仓库:它通过 SDK 依赖 `@earendil-works/{pi-coding-agent,pi-ai,pi-tui}`,有一个可复用的 **headless 测试夹具**(用 pi 真实的 `registerFauxProvider` 录制式假 provider 驱动 `createAgentSession`,不烧真实 LLM),以及 `.agent/` 三个配置文件(`policy.json` / `project-profile.json` / `memory.md`)的 **类型定义 + JSON 校验 + 加载器(仅读写,不含任何行为)**。先做这件事,是因为 C1–C6 的每一个 net-new 模块(安全策略、loop 守卫、eval、MCP)都必须在 faux provider 上做确定性回归——没有这块地基,后面所有验收都没法离线、确定性地证明。本周期不实现任何 agent 行为。

## 2. 范围

### 2.1 In-scope(本周期做)

- **仓库脚手架**:独立 git repo;ESM/`type: module`;`package.json` 声明对 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui`(均 `^0.78.0`)、`typebox`、`commander` 的依赖。
- **构建链**:`tsconfig.json`(对齐 pi 的 `Node16` / `ES2022` / `strict` / `allowImportingTsExtensions`)、`biome.json`(tab 缩进、width 3、lineWidth 120,与 pi 同款)、`esbuild` 打 `dist/cli.js`(带 shebang)。
- **测试运行器**:`vitest`(`--run` 模式),含一个示范性纯函数单测与一个 headless 集成测试。
- **CI 骨架**:GitHub Actions,跑 `lint → typecheck → build → test` 四阶段。
- **★ 关键:headless faux-provider 测试夹具**(`test/harness.ts`),借鉴 pi `test/suite/harness.ts` 的录制式 faux 思路,但走更高层的 `createAgentSession` 路径:用 `registerFauxProvider` + `setResponses(FauxResponseStep[])` 注入脚本化模型输出,拉起一个 `createAgentSession`,采集 `session.subscribe` 事件流,提供 `cleanup()`。
- **`.agent/` 配置系统(仅类型 + 校验 + loader,不含行为)**:`policy.json` / `project-profile.json` / `memory.md` 的 TypeBox schema、加载器、缺省值合成、错误诊断。
- **CLI 外壳与 `--version`**:`commander` 定义 + `agent --version` 输出 binary 版本(读自 `package.json`)。
- **日志**:一个最小结构化 logger(level + JSON/pretty 两种输出),供后续所有模块复用。

### 2.2 Out-of-scope(明确推迟,注明推到哪个 Cycle)

- `createAgentSession` 的真实驱动、`-p` print mode、AGENTS.md/profile 系统提示注入 → **C1**。
- 安全策略引擎、`policy/gateway.ts` 的 `pi.on("tool_call")` 拦截行为(本周期只定义 `policy.json` 的 schema 与 loader,**不**实现 `classify`)→ **C2**。
- loop 守卫、task trace、`appendEntry`、`diff/undo` → **C3**。
- eval harness、fixtures、scoring、回归表 → **C4**(本周期的 faux 夹具是它的前置)。
- MCP client / schema-map / adapter → **C5**。
- `agent init`、profile 探测逻辑、`remember` 工具(本周期只定义 profile/memory 的类型与读写,不实现探测与生成)→ **C1(init)**。
- sandbox-runtime 接入 → **C6**。

## 3. 前置依赖

- **无前序 Cycle**:C0 是 1/7,起点。
- **外部条件**:
  - Node ≥ 20(pi 的 `Node16` resolution + 顶层 await 需要)。
  - 已发布到 npm 的 `@earendil-works/pi-*@^0.78.0`(本仓 `e:/111agent/pi` 即同版本 monorepo 源,可作 `npm link` / `file:` 兜底验证)。
  - **不需要 provider key**:headless 测试全程走 faux provider,夹具内部用 `faux-key` 占位(对齐 pi harness 的 `authStorage.setRuntimeApiKey(provider, "faux-key")`)。真实 key 仅 C1 之后的手动冒烟才需要。

## 4. 工作分解 WBS

| 任务 | 涉及文件/模块 | 说明 | 估时 |
|---|---|---|---|
| T0.1 仓库初始化 | `package.json`、`.gitignore`、`.npmrc` | `type: module`、`bin: { agent: "dist/cli.js" }`、deps 见 §2.1;`engines.node >=20` | 0.25d |
| T0.2 TS 配置 | `tsconfig.json` | 继承 pi 风格:`module/moduleResolution: Node16`、`target: ES2022`、`strict`、`allowImportingTsExtensions`、`resolveJsonModule`、`types: ["node"]` | 0.25d |
| T0.3 Biome 配置 | `biome.json` | 复制 pi 规则:`indentStyle: tab`、`indentWidth: 3`、`lineWidth: 120`、`useConst: error`;`format` + `lint` 均启用 | 0.25d |
| T0.4 esbuild 打包 | `scripts/build.mjs`、`package.json#scripts.build` | bundle `src/main.ts` → `dist/cli.js`,`platform: node`、`format: esm`、external pi 三包,注入 shebang `#!/usr/bin/env node` | 0.5d |
| T0.5 vitest 接线 | `vitest.config.ts`、`package.json#scripts.test` | `test: "vitest --run"`;`environment: node`;`include: ["test/**/*.test.ts"]` | 0.25d |
| T0.6 CLI 骨架 + `--version` | `src/main.ts`、`src/cli/args.ts` | commander program;`agent --version` 读 `package.json#version`;子命令位先占位(`run/ask/review/diff/undo/mcp/eval/init` 注册但 action 抛 "not implemented in C0") | 0.5d |
| T0.7 logger | `src/util/logger.ts` | level(`debug/info/warn/error`)+ `pretty`/`json` 两路输出;`createLogger(scope)`;env `AGENT_LOG_LEVEL` 控制 | 0.5d |
| T0.8 `.agent` schema | `src/config/schema.ts` | 用 `typebox` 定义 `PolicyConfig`/`ProjectProfile`/`MemoryDoc`(memory.md 元信息)的 `TSchema`,导出推断类型 | 1d |
| T0.9 `.agent` loader | `src/config/loader.ts` | `loadAgentConfig(cwd)`:定位 `.agent/`、读三文件、先用 `Value.Default(Schema, raw)` 合成默认值(或 `Value.Cast`)、再用 `Value.Check`/`Value.Errors` 校验并产出诊断、返回 `{ policy, profile, memory, diagnostics }`;缺失文件不报错只走 default + diagnostic | 1d |
| T0.10 配置写盘器 | `src/config/writer.ts` | `writePolicy/writeProfile(cwd, value)`:校验后原子写 JSON(写 tmp + rename);`memory.md` 走纯文本读写。**仅 IO,不生成内容** | 0.5d |
| T0.11 headless faux 夹具 | `test/harness.ts` | 借鉴 pi `test/suite/harness.ts` 思路(走更高层 `createAgentSession`):`createTestSession(opts)` → `registerFauxProvider` + `createAgentSession` + 事件采集 + `cleanup`;暴露 `setResponses/appendResponses/events/eventsOfType/getPendingResponseCount` | 1d |
| T0.12 示范单测 | `test/config-loader.test.ts` | 断言 loader 在合法/非法/缺失三种 `.agent/` 下的行为与诊断 | 0.5d |
| T0.13 no-op headless 集成测试 | `test/noop-session.test.ts` | 用夹具拉一个仅 `read` 工具的 session,`setResponses([fauxAssistantMessage("ok")])` 后 `await session.prompt("hi")`,断言收到 `agent_start`→`message_update`→`agent_end` 且无真实网络 | 0.5d |
| T0.14 CI workflow | `.github/workflows/ci.yml` | `lint(biome check) → typecheck(tsc --noEmit) → build(esbuild) → test(vitest --run)`;Node 20 矩阵;无 secret | 0.5d |
| T0.15 README + 骨架文档 | `README.md`、`docs/architecture.md`(占位) | 写"pi 给了什么 / 我加了什么"边界一页 + 目录结构;后续 Cycle 续写 | 0.25d |

合计约 8.75 人日,压到 7 天靠 T0.1–T0.3 与 T0.15 的并行琐碎工作收口。

## 5. 关键接口 / 数据结构

本周期固化两组接口:`.agent/` 配置类型(用真实 `typebox`),以及 headless 测试夹具(用真实 pi SDK / faux provider API)。

### 5.1 `.agent/` 配置 schema 与 loader(`src/config/`)

注意:`policy.json` 的字段在此**只定义形状**,`classify`/gateway 行为属于 C2;`limits`/`sandbox` 字段先入 schema 以免 C2/C3/C6 反复迁移。

```ts
// src/config/schema.ts
import { Type, type Static } from "typebox";

export const ApprovalMode = Type.Union([
  Type.Literal("readonly"),
  Type.Literal("suggest"),
  Type.Literal("workspace-write"),
  Type.Literal("auto"),
]);

export const PolicyConfigSchema = Type.Object({
  command: Type.Object({
    allow:   Type.Array(Type.String(), { default: [] }),
    confirm: Type.Array(Type.String(), { default: [] }),
    deny:    Type.Array(Type.String(), { default: [] }),
  }),
  path: Type.Object({
    deny:         Type.Array(Type.String(), { default: [] }),
    confirmWrite: Type.Array(Type.String(), { default: [] }),
  }),
  limits: Type.Object({
    maxChangedFiles:   Type.Integer({ default: 20 }),
    maxFixIterations:  Type.Integer({ default: 5 }),
    maxToolCalls:      Type.Integer({ default: 50 }),
    tokenBudget:       Type.Optional(Type.Integer()),
    commandTimeoutMs:  Type.Optional(Type.Integer({ default: 120000 })), // C6 才消费,此刻入 schema 避免迁移
  }),
  sandbox: Type.Object({ enabled: Type.Boolean({ default: false }) }),
});
export type PolicyConfig = Static<typeof PolicyConfigSchema>;

export const ProjectProfileSchema = Type.Object({
  language:       Type.String(),
  packageManager: Type.String(),
  framework:      Type.Optional(Type.String()),
  testFramework:  Type.Optional(Type.String()),
  sourceDirs:     Type.Array(Type.String(), { default: [] }),
  testDirs:       Type.Array(Type.String(), { default: [] }),
  commands: Type.Object({
    test:  Type.Optional(Type.String()),
    lint:  Type.Optional(Type.String()),
    build: Type.Optional(Type.String()),
  }),
});
export type ProjectProfile = Static<typeof ProjectProfileSchema>;
```

```ts
// src/config/loader.ts
export interface AgentConfig {
  policy:  PolicyConfig;      // 缺失则用 schema default 合成
  profile: ProjectProfile | null;  // 缺失为 null(C1 的 init 才生成)
  memory:  string;           // memory.md 原文,缺失为 ""
  diagnostics: ConfigDiagnostic[];  // { file, level: "warn"|"error", message }
}

export function loadAgentConfig(cwd: string): AgentConfig;
// 行为:定位 <cwd>/.agent;读三文件;先用 typebox Value.Default(Schema, raw) 合成默认值(或 Value.Cast),再用 Value.Check / Value.Errors 校验并产出诊断;
// 非法 JSON 或 schema 不符 → push error 诊断并回退 default(不抛,交调用方决定)
```

### 5.2 headless faux-provider 测试夹具(`test/harness.ts`)

直接复用 pi 的真实 API,均为 `@earendil-works/pi-ai` / `@earendil-works/pi-coding-agent` 的公开导出(已对 pi 0.78.0 源码核实)。

```ts
import {
  registerFauxProvider, fauxText, fauxToolCall, fauxAssistantMessage,
  type FauxResponseStep, type FauxProviderRegistration,
} from "@earendil-works/pi-ai";
import {
  createAgentSession, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface TestSession {
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  faux: FauxProviderRegistration;
  setResponses: (steps: FauxResponseStep[]) => void;
  prompt: (text: string) => Promise<void>;  // 驱动一个回合:session.prompt(text)
  events: unknown[];                 // session.subscribe 采集
  eventsOfType: (type: string) => unknown[];
  tempDir: string;
  cleanup: () => void;
}

export async function createTestSession(opts?: {
  tools?: string[];                  // 默认 ["read","grep","find","ls"]
  responses?: FauxResponseStep[];
}): Promise<TestSession> {
  const faux = registerFauxProvider();          // 返回 setResponses / getModel / unregister ...
  faux.setResponses(opts?.responses ?? []);
  const model = faux.getModel();
  const { session } = await createAgentSession({
    cwd: tempDir,
    model,
    tools: opts?.tools ?? ["read", "grep", "find", "ls"],
    sessionManager: SessionManager.inMemory(tempDir),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
  });
  const events: unknown[] = [];
  session.subscribe((e) => events.push(e));
  // cleanup: session.dispose() + faux.unregister() + rm tempDir
}
```

`fauxText`/`fauxToolCall` 返回的是内容块(`TextContent`/`ToolCall`),必须用 `fauxAssistantMessage(...)` 包成一个回合(`FauxResponseStep`);工具回合写作 `fauxAssistantMessage(fauxToolCall(name, argsObj, { id? }))`——`fauxToolCall` 第2参是参数对象、第3参是 `{ id? }` 选项。这正是 C4 eval runner 与 C2/C3 集成测试将依赖的确定性输入。

## 6. 验收标准

- [ ] `npm install` 在干净环境成功,锁定 `@earendil-works/pi-*@0.78.x`、`typebox`、`commander`。
- [ ] `npm run build` 产出可执行 `dist/cli.js`(含 shebang),无 esbuild 报错。
- [ ] `node dist/cli.js --version` 打印与 `package.json#version` 一致的版本号并以 0 退出。
- [ ] `agent --help` 列出占位子命令(`run/ask/review/diff/undo/mcp/eval/init`),调用未实现子命令时给出清晰 "not implemented (planned in C<k>)" 而非崩栈。
- [ ] `npx biome check` 零错误零警告(`--error-on-warnings` 通过)。
- [ ] `tsc --noEmit` 零类型错误(strict 下)。
- [ ] `npm test` 全绿,**且不发起任何真实网络请求**(faux provider 隔离)。
- [ ] 单测覆盖 loader 三态:合法 `.agent/` 正确解析;非法 JSON / schema 不符产出 error 诊断且回退 default;`.agent/` 缺失时返回全 default 且无异常。
- [ ] headless 集成测试:一个仅含只读工具的 no-op session 对着 faux provider 启动,`setResponses([fauxAssistantMessage("ok")])` 后 `await session.prompt("hi")` 驱动一个回合,能在事件流里依次观察到 `agent_start`、`message_update`(`assistantMessageEvent.type === "text_delta"`)、`agent_end`,`cleanup()` 后临时目录被删、faux provider 被 `unregister`。
- [ ] CI 在 push/PR 上跑通四阶段(lint/typecheck/build/test),无需任何 secret。

## 7. 测试计划

- **单测**:`config/loader`(合法/非法/缺失三态 + 诊断断言)、`config/schema`(typebox `Value.Check` 对边界值)、`util/logger`(level 过滤 + JSON 输出形状)。纯函数,不碰 pi runtime。
- **集成(用 pi 的 faux provider 跑 headless session)**:`test/noop-session.test.ts` 通过 `test/harness.ts` 拉起 `createAgentSession`,用 `registerFauxProvider` + `setResponses` 注入脚本化输出,断言事件序列与无网络。这是本周期最重要的一条,也是 C2–C5 所有集成测试的模板。
- **对抗性**:本周期不涉及(无安全行为可攻击;C2 起引入恶意 prompt 套件)。
- **eval**:本周期不涉及(harness 在 C4;但 C0 的 faux 夹具是其直接前置,需保证 `createTestSession` 接口足够通用,能被 C4 的 runner 以 `mode`/`cwd` 复用)。

## 8. 风险与缓解

- **faux provider 是否为公开导出**:已对 pi 0.78.0 源码核实——`registerFauxProvider` / `fauxText` / `fauxToolCall` / `FauxResponseStep` 经 `packages/ai/src/index.ts` 的 `export * from "./providers/faux.ts"` 公开,`createAgentSession` 经 `coding-agent` 的 `core/sdk.ts` 导出。缓解:CI 里跑通即为持续证明;若上游某版本收紧导出,夹具可降级为 `npm link` 本地 monorepo 源。
- **pi 版本漂移**:三包必须同主版本(均 0.78.0)。缓解:`package.json` 用同一 `^0.78.0` 区间并纳入 lockfile;CI 校验三包 resolved 版本一致。
- **Node16 模块解析 + `allowImportingTsExtensions` 与 esbuild bundling 的摩擦**(技术文档 §15-3 之外的工程坑):源码用 `.ts` 扩展名 import 时,tsc 与 esbuild 需一致处理。缓解:esbuild 配置 external 掉 pi 三包、由 bundler 解析相对 `.ts`;CI 中 `tsc --noEmit` 与 `build` 分开把关。
- **`SettingsManager`/`SessionManager` 的 in-memory 构造签名随上游变化**:缓解:夹具集中封装这两处构造,变更只改一处。
- **(对应技术文档 §15-1)token 硬上限钩子未知**:本周期不实现预算,但 schema 已预留 `limits.tokenBudget`,避免 C3 反复迁移配置;真正的中断时序验证留 C3。

## 9. Definition of Done

- [ ] 代码:仓库脚手架、构建链、CLI 骨架、logger、`.agent` schema/loader/writer、headless 夹具全部合入主干。
- [ ] 测试:单测 + headless 集成测试全绿;`npm test` 离线可跑。
- [ ] 质量门:`biome check` 与 `tsc --noEmit` 双零。
- [ ] CI:`ci.yml` 在 PR 上四阶段通过且不依赖 secret。
- [ ] 文档:`README.md` 含目录结构与"pi 给了什么/我加了什么"边界段;`docs/architecture.md` 占位就位,供后续 Cycle 续写。
- [ ] 演示:§10 两条命令可现场跑通。
- [ ] 无任何 agent 行为代码混入(策略 `classify`、loop 守卫、trace、mcp、eval 均不在本周期)。

## 10. 周期演示

```bash
# 1) binary 可运行
agent --version
#   → 打印版本号(例:0.0.1),退出码 0

# 2) 子命令骨架可见
agent --help
#   → 列出 run/ask/review/diff/undo/mcp/eval/init(占位)

# 3) 地基测试:no-op headless session 对着 faux provider 启动并收到事件
npm test
#   → vitest 全绿;noop-session.test.ts 在 setResponses 后 await session.prompt("hi") 驱动一个回合,输出 agent_start / message_update / agent_end 断言通过
#   → 无任何真实 LLM 网络调用
```

## 11. 交付物

- **代码模块**:`src/main.ts`、`src/cli/args.ts`、`src/util/logger.ts`、`src/config/{schema,loader,writer}.ts`。
- **构建/质量配置**:`package.json`、`tsconfig.json`、`biome.json`、`scripts/build.mjs`、`vitest.config.ts`。
- **测试**:`test/harness.ts`(★ headless faux-provider 夹具)、`test/config-loader.test.ts`、`test/noop-session.test.ts`。
- **CI**:`.github/workflows/ci.yml`(lint/typecheck/build/test,Node 20,无 secret)。
- **文档**:`README.md`(边界一页 + 目录结构)、`docs/architecture.md`(占位骨架)。
- **demo 脚本**:§10 三条命令(可收进 `README.md` 的 Quickstart)。