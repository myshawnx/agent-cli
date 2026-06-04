# Cycle C5:v0.5 — MCP Adapter + GitHub Demo(预计 9 天 · 周期 6/7)

## 1. 周期目标

本周期把"外部工具集成"这条支柱落地:实现一个 stdio + JSON-RPC 2.0 的 MCP 客户端,把任意 MCP server 的工具经 `schema-map` 映射为 pi 的 TypeBox 参数、经 `mcp/adapter.ts` 这个 extensionFactory 桥接成 `pi.registerTool` 注册的工具,从而让 agent loop 能像调内置工具一样调外部工具。排在 C4(eval harness)之后、C6(硬化发布)之前,是因为 MCP 是四大支柱里风险最高的集成项(子进程生命周期、JSON Schema 子集映射、崩溃不卡 loop),需要先有 C4 的 faux-provider headless 跑场景的能力来回归它,也需要 C2 的 gateway 已经稳定——MCP 工具产生的写/命令调用必须照样过安全策略。周期结束时能现场跑通 GitHub 端到端 demo:`agent mcp add github` → "按 issue #12 修复" → 读 issue → 改码(经 C2 gateway)→ 跑测试 → 生成 PR summary。

## 2. 范围

### 2.1 In-scope(本周期做)

- `src/mcp/client.ts`:stdio JSON-RPC 2.0 客户端。`spawn` 子进程、Content-Length framing、`initialize` 握手、`tools/list`、`tools/call`;`AbortSignal` 透传取消;`onCrash` 回调 + 指数退避重启;`dispose` 清理。
- `src/mcp/schema-map.ts`:JSON Schema → TypeBox 子集映射。支持 `object`/`string`/`enum`(用 `StringEnum`)/`number`/`integer`/`boolean`/`array`;`oneOf`/`anyOf`/`$ref`/递归结构走 `Type.Unknown()` 宽松透传(`strict:false`)或跳过该工具并告警(`strict:true`)。**纯函数,本周期硬性要求单测。**
- `src/mcp/adapter.ts`:extensionFactory。`session_start` 时按 config 启动各 server、`listTools`、用 `mcp__<server>__<tool>` 前缀 `pi.registerTool` 桥接;`execute` 代理 `client.callTool` + `truncateTail` 截断 + `signal` 透传;`session_shutdown` 时 `dispose` 所有 client;server 崩溃用 `pi.setActiveTools` 摘掉对应工具,不卡死 loop。
- `src/mcp/config.ts`:`.agent/mcp.json` 的读写与 schema 校验。
- `src/cli/commands/mcp.ts`:`agent mcp add <name> ...` / `agent mcp list` / `agent mcp remove <name>` 三个子命令,落到 `mcp/config.ts`。
- GitHub 端到端 demo 脚本与一个最小可跑的 demo fixture(planted-bug repo + 一个 stub/真实 GitHub MCP server),把全链路串起来。
- `schema-map` 单测(各分支)、`client` 与 stub server 的集成测试、adapter 在 faux provider 下的 headless 集成测试。

### 2.2 Out-of-scope(明确推迟,注明推到哪个 Cycle)

- **MCP 流式结果**(`tools/call` 的增量 `onUpdate` 透传):本版按一次性结果处理(技术文档 §15.4),流式留到 C6。
- **OAuth / 远程 SSE transport 的 MCP server**:本版只做本地 stdio 子进程,远程 transport 不在范围。
- **MCP server 的 resources / prompts capability**:只桥接 tools;resources/prompts 不做。
- **完整 JSON Schema 支持**(`oneOf`/`allOf`/`$ref` 的精确求解、`format`/`pattern`/数值边界校验):明确只做子集 + 透传,不追求完备(技术文档 §15.3),不推迟、直接不做。
- **安全策略层、loop guards、eval harness、trace 投影**本身的新功能:分别属 C2/C3/C4,本周期只**复用**它们,不改其逻辑(若 MCP 工具暴露策略缺口,记 issue 留 C6 硬化)。
- README 架构图 + "pi 给了什么/我加了什么"设计说明:C6。

## 3. 前置依赖

- **C0**:仓库脚手架、`package.json`(deps 含 `@earendil-works/{pi-coding-agent,pi-ai}`、`typebox`、`commander`)、vitest/tsc/biome 测试地基、`test/suite/harness.ts` 同构的 faux-provider 封装。
- **C1**:`src/runtime/session-factory.ts`(`buildSession` / `computeTools(mode)`)、`src/runtime/resource-loader.ts`(`buildResourceLoader` 把 extensionFactory 列表挂进 `DefaultResourceLoader.extensionFactories`)、`src/runtime/driver.ts`(print/interactive)、`agent init` 生成 `.agent/`。MCP adapter 作为新的 extensionFactory 追加进 `buildResourceLoader` 的工厂数组。
- **C2**:`src/policy/gateway.ts`(`pi.on("tool_call")` 拦截)+ `src/policy/engine.ts`(`classify`)。demo 中"改码经 gateway"依赖它已就绪;注意 MCP 工具名以 `mcp__` 开头、`classify` 的 `default: allow` 分支会放行,这点要在 demo 里讲清楚(见 §8 风险)。
- **C3**:`src/loop/guards.ts`(预算/反作弊)。MCP 工具调用同样计入 `maxToolCalls` 预算——靠 guards 已挂的 `tool_call` 钩子自动覆盖,本周期不改 guards。
- **C4**:`src/eval/harness.ts` 的 headless `buildSession` 跑场景能力 + faux provider,用于回归 adapter 集成。
- **外部条件**:
  - 单测 / 集成测试:**不需要** provider key,用 C0/C4 的 faux provider;`client` 测试用仓内自带的一个 stub MCP server(Node 脚本,几十行,实现 `initialize`/`tools/list`/`tools/call`)。
  - GitHub 真跑 demo:需要 `GITHUB_TOKEN`(或 `GITHUB_PERSONAL_ACCESS_TOKEN`)环境变量 + 一个可用的 GitHub MCP server(`npx -y @modelcontextprotocol/server-github` 或等价),以及一个真实 provider key(如 `ANTHROPIC_API_KEY`)。demo 的录制版用 faux provider + stub github server,不烧真实调用。

## 4. 工作分解 WBS

| 任务 | 涉及文件/模块 | 说明 | 估时 |
|---|---|---|---|
| T5.1 | `src/mcp/config.ts`、`src/mcp/types.ts` | 定义 `McpServerConfig` / `McpConfig`;读写 `.agent/mcp.json`,缺失时返回空配置;写入做原子替换 + JSON 校验(非法结构报错不静默) | 0.5d |
| T5.2 | `src/mcp/client.ts`(framing 层) | `spawn(cfg.command, cfg.args, { env })`;实现 Content-Length 帧的编解码(stdout 累积缓冲 → 切帧 → JSON.parse);id→pending Promise 路由;`stderr` 收集供诊断 | 1d |
| T5.3 | `src/mcp/client.ts`(协议层) | `start()`:`initialize` 握手(protocolVersion / clientInfo / capabilities)+ `notifications/initialized`;`listTools()` 调 `tools/list`(处理分页 `nextCursor`);`callTool(name,args,signal)` 调 `tools/call`,`signal.abort` → 发 `$/cancelRequest` 或直接 reject pending | 1d |
| T5.4 | `src/mcp/client.ts`(生命周期) | `onCrash(cb)`:监听子进程 `exit`/`error`,标记 unavailable,触发 cb;指数退避重启(基数 500ms、上限 3 次、cap 30s);`dispose()` 杀进程 + reject 所有 pending + 移除监听 | 0.5d |
| T5.5 | `src/mcp/schema-map.ts` | `toTypeBox(s, opts)` 递归映射:string/number/integer/boolean/array/object/enum(`StringEnum`);`required` → `Type.Optional` 取反;不支持节点 `strict:false`→`Type.Unknown()`+告警计数,`strict:true`→抛 `UnsupportedSchemaError` 让 adapter 跳过该工具 | 1d |
| T5.6 | `src/mcp/schema-map.test.ts` | 单测覆盖每个分支 + 边界:无 `type`、`enum`、嵌套 `object`、`array` of object、缺 `items`、`oneOf`/`anyOf`/`$ref`/递归在两种 strict 下的行为、`required` 处理 | 1d |
| T5.7 | `src/mcp/adapter.ts` | extensionFactory:`session_start` 启动 client + `listTools` + 逐工具 `registerTool`(前缀命名、`description` 透传、`parameters` = `toTypeBox`、`execute` 代理 `callTool`+`truncateTail`+`signal`);跳过映射失败工具并 `ctx.ui.notify` 告警 | 1d |
| T5.8 | `src/mcp/adapter.ts`(崩溃 + 收尾) | `onCrash` → `pi.setActiveTools(pi.getActiveTools().filter(...))` 摘工具;重启成功后重新 `registerTool` + 恢复 active;`session_shutdown` → `clients.forEach(c => c.dispose())` | 0.5d |
| T5.9 | `src/cli/commands/mcp.ts`、`src/cli/args.ts` | `agent mcp add <name> -- <command> [args...]`(或 `--command/--arg/--env` 形式)、`agent mcp list`(表格)、`agent mcp remove <name>`;校验重名;写入经 T5.1 | 0.5d |
| T5.10 | `test/mcp/stub-server.ts` | 仓内 stub MCP server:实现 `initialize`/`tools/list`(返回 `echo`、`get_issue` 等)/`tools/call`;支持 `--crash-after N` 用于崩溃测试 | 0.5d |
| T5.11 | `test/mcp/client.test.ts` | client × stub-server 集成:握手、list、call、abort 取消、崩溃触发 onCrash + 退避重启 | 0.5d |
| T5.12 | `test/mcp/adapter.test.ts` | faux provider headless:断言注册出 `mcp__stub__echo`、agent 调用后 execute 代理成功、大输出被 `truncateTail` 截断、崩溃后工具被摘且 loop 不挂 | 0.5d |
| T5.13 | `demo/github/`(fixture + 脚本) | planted-bug repo 快照 + stub-github MCP server(get_issue/create_pr_comment)+ `demo/github/run.sh`(faux 录制版)+ `demo/github/run-live.sh`(真 token 版)+ README 步骤 | 1d |

合计 ≈ 9.5d,含缓冲取整 9d(一人开发)。

## 5. 关键接口 / 数据结构

### 5.1 配置(`src/mcp/config.ts` / `types.ts`)

```ts
export interface McpServerConfig {
  name: string;                       // 唯一,用于工具名前缀 mcp__<name>__
  command: string;                    // 例如 "npx"
  args: string[];                     // 例如 ["-y", "@modelcontextprotocol/server-github"]
  env?: Record<string, string>;       // 例如 { GITHUB_TOKEN: "$GITHUB_TOKEN" }
  strictSchema?: boolean;             // 默认 false(宽松透传);true 时跳过映射不了的工具
}

export interface McpConfig { servers: McpServerConfig[] }

export function loadMcpConfig(cwd: string): McpConfig;          // 读 .agent/mcp.json,缺失返回 { servers: [] }
export function saveMcpConfig(cwd: string, cfg: McpConfig): void; // 原子写 + 校验
```

`.agent/mcp.json` 形态:

```jsonc
{
  "servers": [
    { "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" } }
  ]
}
```

### 5.2 客户端(`src/mcp/client.ts`)

```ts
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: JsonSchema;            // JSON Schema 对象,交给 schema-map
}

export interface McpResult {
  content: Array<{ type: "text"; text: string } | { type: string; [k: string]: unknown }>;
  isError?: boolean;
}

export class McpClient {
  constructor(cfg: McpServerConfig);
  start(): Promise<void>;                                            // spawn + initialize 握手
  listTools(): Promise<McpToolDef[]>;                                // tools/list(含分页)
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpResult>; // tools/call
  onCrash(cb: () => void): void;                                     // 退出 → 标记不可用 + 退避重启
  dispose(): void;                                                   // 杀进程 + reject pending
  get available(): boolean;
}
```

### 5.3 Schema 映射(`src/mcp/schema-map.ts`)

```ts
import { Type, type TSchema } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";   // 见 packages/ai/src/utils/typebox-helpers.ts

export interface MapOptions { strict?: boolean; onWarn?: (msg: string) => void }
export class UnsupportedSchemaError extends Error {}

export function toTypeBox(s: JsonSchema, opts: MapOptions = {}): TSchema {
  switch (s.type) {
    case "string":  return s.enum ? StringEnum(s.enum as string[]) : Type.String();
    case "number":  return Type.Number();
    case "integer": return Type.Integer();
    case "boolean": return Type.Boolean();
    case "array":   return Type.Array(toTypeBox(s.items ?? { type: "string" }, opts));
    case "object": {
      const req = new Set(s.required ?? []);
      const props = Object.fromEntries(
        Object.entries(s.properties ?? {}).map(([k, v]) => {
          const t = toTypeBox(v, opts);
          return [k, req.has(k) ? t : Type.Optional(t)];
        }),
      );
      return Type.Object(props);
    }
    default:        // oneOf/anyOf/$ref/递归/无 type
      if (opts.strict) throw new UnsupportedSchemaError(`unsupported schema: ${JSON.stringify(s).slice(0, 80)}`);
      opts.onWarn?.("schema 走宽松透传 Type.Unknown");
      return Type.Unknown();
  }
}
```

### 5.4 桥接(`src/mcp/adapter.ts`,extensionFactory)

真实 pi 接口:`pi.registerTool` 的 `execute(toolCallId, params, signal, onUpdate, ctx)`(见 `core/extensions/types.ts` 的 `ToolDefinition`);`pi.setActiveTools/getActiveTools`;`on("session_start"|"session_shutdown")`。注意 `truncateTail(content, opts)` 返回 `TruncationResult`,正确字段是 `.content`(不是技术文档草稿里的 `.text`),见 `core/tools/truncate.ts`。

```ts
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "@earendil-works/pi-coding-agent";
import { McpClient } from "./client.ts";
import { toTypeBox, UnsupportedSchemaError } from "./schema-map.ts";

export const mcpAdapter = (cfgs: McpServerConfig[]): ExtensionFactory => (pi: ExtensionAPI) => {
  const clients: McpClient[] = [];

  const registerServerTools = async (cfg: McpServerConfig, client: McpClient, notify: (m: string) => void) => {
    for (const tool of await client.listTools()) {
      const full = `mcp__${cfg.name}__${tool.name}`;
      let params;
      try {
        params = toTypeBox(tool.inputSchema, { strict: cfg.strictSchema ?? false, onWarn: notify });
      } catch (e) {
        if (e instanceof UnsupportedSchemaError) { notify(`跳过无法映射的工具 ${full}: ${e.message}`); continue; }
        throw e;
      }
      pi.registerTool({
        name: full,
        label: `MCP: ${cfg.name}/${tool.name}`,
        description: tool.description ?? `MCP tool ${tool.name} from ${cfg.name}`,
        parameters: params,
        async execute(_toolCallId, args, signal) {
          const res = await client.callTool(tool.name, args, signal);
          const text = res.content.filter((c) => c.type === "text").map((c: any) => c.text).join("\n");
          const out = truncateTail(text, { maxBytes: 8_000 }).content;   // 复用 pi 截断
          return { content: [{ type: "text", text: out }], details: { mcp: res }, isError: res.isError };
        },
      });
    }
  };

  pi.on("session_start", async (_e, ctx) => {
    const notify = (m: string) => ctx.ui.notify(m, "warning");
    for (const cfg of cfgs) {
      const client = new McpClient(cfg);
      clients.push(client);
      try {
        await client.start();
      } catch (err) { notify(`MCP server ${cfg.name} 启动失败,已跳过: ${String(err)}`); continue; }
      client.onCrash(() => {
        // 摘掉该 server 的所有工具,loop 不卡死
        pi.setActiveTools(pi.getActiveTools().filter((n) => !n.startsWith(`mcp__${cfg.name}__`)));
        ctx.ui.notify(`MCP server ${cfg.name} 崩溃,已摘除其工具`, "error");
        // 退避重启成功后由 client 内部回调重新 registerServerTools + 恢复 active
      });
      await registerServerTools(cfg, client, notify);
    }
  });

  pi.on("session_shutdown", () => { for (const c of clients) c.dispose(); });
};
```

### 5.5 CLI(`src/cli/commands/mcp.ts`)

```bash
agent mcp add github -- npx -y @modelcontextprotocol/server-github   # 写 .agent/mcp.json
agent mcp add github --env GITHUB_TOKEN=$GITHUB_TOKEN -- npx -y ...
agent mcp list                                                       # 表格:name / command / #tools(若可探测)
agent mcp remove github
```

## 6. 验收标准

- [ ] `agent mcp add <name> -- <cmd> [args...]` 把一条 server 写进 `.agent/mcp.json`;`agent mcp list` 列出它;`agent mcp remove <name>` 删除它;重名 add 报错不覆盖。
- [ ] `McpClient.start()` 能 spawn stub server、完成 `initialize` 握手;`listTools()` 返回 stub 声明的工具列表(含分页拼接)。
- [ ] `callTool(name,args,signal)` 正常返回结果;传入已 abort 的 signal 时及时 reject/取消,不悬挂。
- [ ] stub server 崩溃(`--crash-after 1`)→ `onCrash` 被触发 → 指数退避重启;期间 pending 调用被 reject 而非吞掉。
- [ ] `schema-map` 单测全绿,覆盖 string/enum/number/integer/boolean/array/object/required;`oneOf`/`anyOf`/`$ref`/递归在 `strict:false` 下产出 `Type.Unknown()` 并计一次告警、在 `strict:true` 下抛 `UnsupportedSchemaError`。
- [ ] adapter 在 faux-provider headless session 下:能注册出 `mcp__stub__echo`,LLM 触发后 `execute` 成功代理 `callTool`,返回内容存在。
- [ ] 大输出(>8KB)经 `truncateTail({ maxBytes: 8000 }).content` 截断后回灌,`details.mcp` 保留原始结果。
- [ ] server 崩溃后,`pi.getActiveTools()` 不再含该 server 的 `mcp__<name>__*` 工具,且 agent loop 能继续推进到 `agent_end`(不卡死)。
- [ ] `session_shutdown` 后所有 MCP 子进程被 `dispose`,无残留进程(测试用进程列表/句柄断言)。
- [ ] **GitHub demo 可现场跑通**(见 §10):录制版用 stub-github + faux provider 一键过;live 版在配好 `GITHUB_TOKEN` 时能读到真实 issue 并产出 PR summary 文本。
- [ ] MCP 工具触发的写/命令调用仍然经 C2 gateway(demo 中故意诱发一次 deny,展示拦截照样生效)。

## 7. 测试计划

- **单测(纯函数,不碰 LLM)**:`mcp/schema-map.test.ts` —— 见 T5.6,每个 `type` 分支 + `required`/`Optional` + 不支持节点两种 strict 行为 + `array` 缺 `items` 兜底。这是本周期最高优先级的单测,**硬性要求**。
- **集成(client × stub server)**:`mcp/client.test.ts` —— 用仓内 `test/mcp/stub-server.ts` 真实 spawn 子进程,断言握手/list/call/abort/崩溃重启。属真子进程 IO 测试,不依赖网络。
- **集成(adapter headless,用 pi faux provider)**:`mcp/adapter.test.ts` —— 复用 C0/C4 的 `registerFauxProvider` + `setResponses`(faux 脚本里安排一次 `mcp__stub__echo` tool call),通过 `buildSession`/headless harness 跑;断言工具注册、execute 代理、截断、崩溃摘工具后 loop 仍能结束。
- **对抗性**:在 `mcp.json` 注入一个声明恶意工具(如 `run_shell`,inputSchema 诱导写 `.env`)的 stub server;断言其调用产生的写/bash 仍被 C2 gateway 拦截(MCP 不绕过策略)。
- **eval**:本周期不新增 eval 场景文件;但跑一次 `agent eval`(C4)的录制基线,确认引入 adapter extensionFactory 后既有场景**无回归**(adapter 在无 `mcp.json` 时应为零副作用)。

## 8. 风险与缓解

- **R1:JSON Schema → TypeBox 映射不全(技术文档 §15.3)。** 缓解:明确只做子集 + `Type.Unknown()` 透传,`strict` 模式跳过并 `ctx.ui.notify` 告警,绝不假装"已解决";单测固化每条边界;`details.mcp` 始终保留原始结果,即使参数宽松也可诊断。
- **R2:server 崩溃把 pi 的 agent loop 卡死。** 缓解:`callTool` 全程 Promise + `signal`,崩溃即 reject pending;`onCrash` 用 `pi.setActiveTools` 摘工具让 loop 看不到失效工具;退避重启上限 3 次后保持摘除状态,不无限重启。集成测试 T5.12 专门断言"崩溃后能到 `agent_end`"。
- **R3:MCP 工具绕过安全策略(策略缺口)。** C2 `classify` 对未知工具名走 `default: allow`,意味着 `mcp__github__*` 这类工具调用本身不被分级。缓解:demo 与文档诚实说明——**MCP 工具产生的次级写/命令仍经 gateway**(因为它们最终走 pi 的 edit/write/bash);但 MCP 工具**自身的副作用**(如 `create_pr_comment` 发网络请求)不在字符串风险分级覆盖内,定位为"集成边界,非安全边界",真边界靠 sandbox(C2 的 sandbox 选项)。把"为未知/MCP 工具增加可配置 confirm 默认"记为 C6 硬化项。
- **R4:abort 时序不可靠(技术文档 §15.1)。** pi 的 `signal` 来自 `ctx.signal`,但 `tools/call` 是跨进程的。缓解:`callTool` 监听 `signal.abort` 立即 reject 本地 pending(不等子进程),并尽力发取消通知;不号称强制中断远端执行,文档写明。
- **R5:stdio framing / 大 JSON 解析错误。** 缓解:Content-Length 严格切帧 + 容错(解析失败丢弃该帧并记 stderr 诊断,不崩客户端);`truncateTail` 防 50KB JSON 撑爆上下文。
- **R6:demo 对真实 GitHub token / 网络的依赖使其不稳定。** 缓解:双轨——录制版(stub-github + faux provider)进 CI 必过、零外部依赖;live 版只在本地手动跑,且在缺 token 时优雅报错。

## 9. Definition of Done

- [ ] `src/mcp/{config,types,client,schema-map,adapter}.ts` 与 `src/cli/commands/mcp.ts` 全部实现并接进 `buildResourceLoader` 的 extensionFactory 数组(C1)。
- [ ] `tsc --noEmit` 无类型错误;biome lint 通过。
- [ ] `mcp/schema-map.test.ts`(单测)、`mcp/client.test.ts`(client×stub 集成)、`mcp/adapter.test.ts`(faux headless 集成)、对抗性测试全绿。
- [ ] 既有 C0–C4 测试无回归;`agent eval` 录制基线无新增 fail。
- [ ] GitHub demo 录制版一键跑通并断言 PR summary 文本生成;live 版手动验证一次通过。
- [ ] `agent mcp --help` 与文档诚实标注:子集 schema 支持、stdio-only、MCP 非安全边界(R3)、流式留待后续。
- [ ] `demo/github/README.md` 写清两种跑法与所需环境变量。

## 10. 周期演示

录制版(CI 友好,无外部依赖,用 stub-github + faux provider):

```bash
bash demo/github/run.sh
# 预期可见:
#  1) [mcp] spawned server "github" (stub)
#  2) registered tools: mcp__github__get_issue, mcp__github__create_pr_comment
#  3) agent: 调用 mcp__github__get_issue({ number: 12 }) → 读到 issue 正文
#  4) agent: edit src/middleware/auth.ts(经 policy gateway: allow)→ pnpm test PASS
#  5) agent: 调用 mcp__github__create_pr_comment → 输出 PR summary 文本
#  6) demo OK: PR summary contains "401"
```

live 版(需 GITHUB_TOKEN + 真实 provider key):

```bash
export GITHUB_TOKEN=...           # 真实 token
agent mcp add github --env GITHUB_TOKEN=$GITHUB_TOKEN -- npx -y @modelcontextprotocol/server-github
agent "按 GitHub issue #12 修复,并补测试"
# 预期:读真实 issue → 改码(经 gateway)→ 跑测试 → 生成 PR summary 评论草稿
```

附带的拦截演示(证明 MCP 不绕过 C2):

```bash
agent mcp list                    # 显示已配置的 github server
# 在 demo 中故意诱发 rm -rf / 写 .env → 终端可见 "已阻断:高危命令 / 受保护路径"
```

## 11. 交付物

- 代码:`src/mcp/config.ts`、`src/mcp/types.ts`、`src/mcp/client.ts`、`src/mcp/schema-map.ts`、`src/mcp/adapter.ts`、`src/cli/commands/mcp.ts`(+ `src/cli/args.ts` 中 `mcp` 子命令注册);`buildResourceLoader` 接入 `mcpAdapter(cfg.servers)`。
- 测试:`test/mcp/stub-server.ts`、`test/mcp/client.test.ts`、`test/mcp/adapter.test.ts`、`src/mcp/schema-map.test.ts`、对抗性 MCP 测试。
- 配置样例:`.agent/mcp.json` 模板(写进 `agent init` 的可选骨架或文档)。
- Demo:`demo/github/`(planted-bug fixture 快照、`stub-github` MCP server、`run.sh` 录制版、`run-live.sh` 真 token 版、`README.md`)。
- 文档片段:MCP 集成说明(子集 schema / stdio-only / 非安全边界 / 流式 TODO),供 C6 汇入总 README。
