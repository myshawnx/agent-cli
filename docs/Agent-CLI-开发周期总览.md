# Agent CLI 开发周期总览 + 一致性修订(规范层)

> 本文是 7 份周期开发文档的**总纲**。它给出周期划分、依赖图、时间线,并把跨周期一致性评审发现的**缺口/重叠/依赖问题**收敛成一组**规范性修订**。当前仓库已进入 v1.0/C6 收口状态,下文同时记录这些规范项在代码中的落地情况。
>
> 周期文档:[C0](dev-cycles/C0-foundation.md) · [C1](dev-cycles/C1-readonly-shell.md) · [C2](dev-cycles/C2-safety-policy.md) · [C3](dev-cycles/C3-loop-trace-diff.md) · [C4](dev-cycles/C4-eval-harness.md) · [C5](dev-cycles/C5-mcp-adapter.md) · [C6](dev-cycles/C6-harden-release.md)
> 源文档:[需求文档 v2](Agent-CLI-需求文档.md) · [技术实现文档](Agent-CLI-技术实现文档.md)

---

## 1. 周期一览与时间线

| Cycle | 主题 | 估时 | 交付支柱 |
|---|---|---|---|
| C0 | 项目基建与测试地基 | 7d | 仓库/构建/CI/**faux-provider 夹具**/`.agent` schema |
| C1 | v0.1 SDK 外壳与只读理解 | 6d | `createAgentSession` 封装、`-p`、profile、init |
| C2 | v0.2 安全策略层 | 8d | ★ approval-mode + 命令分级 + path-guard + 对抗测试 |
| C3 | v0.3 控制流守卫 + Task Trace + diff/undo | 9d | ★ 预算/反作弊守卫、trace 投影、resume/undo |
| C4 | v0.4 Eval / Benchmark Harness | 7d | ★★ 度量基石(最高信号) |
| C5 | v0.5 MCP Adapter + GitHub Demo | 9d | ★ 外部工具集成 |
| C6 | v1.0 硬化、演示、发布 | 9d | 三支柱联调 + demo + README + 发布硬化 |

**合计 ≈ 55 人日 ≈ 11 周(单人)。** 关键路径 C0→C1→C2→C3→C4/C6。

## 2. 依赖图

```
C0 ──► C1 ──► C2 ──► C3 ──┐
        │      │      │   ├──► C4 ──┐
        │      └──────┴───┤         ├──► C6
        └────────► C5 ◄───┘         │
                    └───────────────┘
```
- C4(eval)依赖 C1 的 `buildSession`/`buildResourceLoader`、C2 的 deny 记录、C3 的 trace。
- C5(MCP)依赖 C1 的扩展挂载、C2 的 gateway(MCP 工具的次级写/命令仍过策略)。
- C6 依赖全部前序。

---

## 3. ★ 规范性修订(评审结论,放行前必须回填)

评审结论:**方案可行,但 C4 反向依赖了 C1/C2 本应预埋却没预埋的接口;另有 3 个模块无人认领。** 下列修订**前移**到 C1/C2,避免 C4 降级实现与后期 schema 迁移。

### 3.1 C1 必须暴露的三个接缝(否则 C4 无法复用主路径)

```ts
// runtime/resource-loader.ts —— 允许外部追加扩展工厂(C4 注入 evalProbe、测试注入 mock)
export function buildResourceLoader(
  ctx: ProjectContext,
  opts?: { extraFactories?: ExtensionFactory[] },   // ★ 新增
): DefaultResourceLoader;
//   当前实现:extensionFactories =
//   [policyGateway, loopGuards, traceRecorder, commandTimeoutBash, rememberTool,
//    ...(mode !== "readonly" ? [mcpAdapter] : []), ...(opts?.extraFactories ?? [])]

// runtime/session-factory.ts —— 允许注入 provider/model(C4 切 faux/real;默认仍 anthropic)
export function buildSession(opts: {
  cwd: string; mode: ApprovalMode; resourceLoader: ResourceLoader;
  model?: Model;            // ★ 新增:缺省 getModel("anthropic", config.model)
}): Promise<{ session: AgentSession }>;

// 当前工具激活口径:
// - readonly: createAgentSession({ tools: computeTools("readonly") }) 保留 pi 全局 allowlist 硬边界
// - 非 readonly: createAgentSession({ noTools: "builtin" }) 后再 setActiveToolsByName(computeTools(mode))
//   以免 pi 的全局 tools allowlist 过滤 session_start 动态注册的 mcp__* 工具。

// runtime/driver.ts —— 预留 usage 订阅接缝(C3 token 软停 / C6 预算验证复用,避免反向改 driver)
export function drive(session, opts: {
  printMode: boolean; prompt: string;
  onUsage?: (u: TokenUsage) => void;   // ★ 新增:print 与 interactive 都透传 session 的 usage 事件
}): Promise<void>;
```

### 3.2 C2 必须预埋的两项

```ts
// policy/gateway.ts —— deny/confirm-被拒 时把判决写进 pi session(单一真相源),供 C4 的 inBounds 评分读取
//   在返回 { block:true } 之前:
pi.appendEntry("policy-deny", { tool: event.toolName, reason: v.reason });

// policy/types.ts —— limits 一次性固化时就带上 commandTimeoutMs(C6 实现 bash 超时中止,但 schema 不再迁移)
export interface Limits {
  maxChangedFiles: number; maxFixIterations: number; maxToolCalls: number;
  tokenBudget?: number;
  commandTimeoutMs?: number;   // ★ 默认 120_000,C6 才用,但此刻入 schema
}
```

> 同步把 `commandTimeoutMs` 加进 C0 的 `.agent` schema 默认骨架,保持 C0/C2「一次固化、避免反复迁移」原则。

### 3.3 三个无人认领模块 → 明确归属

| 落空模块 | 现状 | 规范归属 |
|---|---|---|
| `agent review`(读 git diff → 风险/缺测试/建议) | 从 C0 占位一路滑到 C6 仍无人实现 | **归 C2**(review = 读 diff → 经 `classify`/风险分级输出),在 C2 的 in-scope + WBS + 验收 + `cli/args.ts` 注册中显式落地 |
| `remember` 工具 + `memory.md` 写入端 | C0→C1→C3→C6 互相推,只交付了只读 | **归 C3**(与 `traceRecorder`/`appendEntry` 同源:把元数据写进 pi session),补单测/集成 |
| MCP/未知工具安全分级 | C2 对未知工具名 `default: allow`;C5 R3 记为「C6 硬化项」却无人闭合 | **归 C6 in-scope**:`engine` default 分支对未知工具(含 `mcp__*`)默认 `confirm`(可经 policy 配 allow),补对抗测试(诱导 `mcp__*` 直接产生副作用) |

### 3.4 Hook 顺序与计数边界(消除 C2/C3 重叠)

- **固定扩展工厂注册顺序**:`policyGateway → loopGuards → traceRecorder → commandTimeoutBash → rememberTool → mcpAdapter(仅非 readonly) → extraFactories`。任一 `tool_call` hook 返回 `{block:true}` 即短路,**首个 block 的 reason 为准**。
- **计数规则**:被 `policyGateway` deny 的 `tool_call`**不计入** `loopGuards` 的 `maxToolCalls` 预算(写进 C3 验收)。
- **生命周期时序**:`mcpAdapter` 在非 `readonly` 会话的 `session_start` 读取 `.agent/mcp.json`、创建持久 stdio client 并注册 `mcp__*` 工具;`policyGateway/loopGuards/traceRecorder` 在 `agent_start` / `tool_call` / `tool_result` / `agent_end` 等生命周期中工作。print 路径会显式 `session.bindExtensions({})` 以触发 `session_start`。
- **faux provider 依赖去重**:`postinstall` 运行 `scripts/dedupe-pi-ai.mjs`,确保 headless 测试中的 `registerFauxProvider()` 与 agent loop 共享同一个顶层 `@earendil-works/pi-ai` registry;若安装时禁用 lifecycle scripts,相关 faux 集成测试可能失败。

### 3.5 C6 当前完成状态

| C6 项 | 当前状态 |
|---|---|
| T6.1 三支柱联调 | 已由 `test/integration/three-pillars.test.ts` 覆盖:同一 faux headless session 中同时观测 policy deny、loop guard、trace entry、MCP 动态工具注册 |
| T6.3 command timeout | 已由 `test/integration/command-timeout.test.ts` 覆盖:真实 bash 长跑命令受 `commandTimeoutMs` 中止 |
| T6.4 patch locate | 已由 `test/loop/guards.test.ts` 覆盖无 UI soft-stop、有 UI 确认重试/拒绝分支;端到端覆盖仍可作为后续增强 |
| T6.5 abort failsafe | 已由 `test/integration/abort-failsafe.test.ts` 覆盖:SIGTERM 时保留 modified files、写 `abort-preserved` 和 failed `task-result` |
| T6.6 token budget | 已由 `test/integration/token-budget.test.ts` 覆盖:usage 超过 `tokenBudget` 后 soft-stop,并在下一次 tool call 前阻断 |

### 3.6 文档口径修正

- `truncateTail(content, opts)` 返回 `TruncationResult`,字段是 **`.content`**(技术文档草稿里的 `.text` 是错的,C5 已更正)。C6 汇编总 README 时不要把旧写法带回。
- `.agent/mcp.json`:由 **C5 的 `agent mcp add` 生成**(运行期),C1 的 `init` 不产出——在 C1 文档显式声明,消除「init 产出 mcp.json 骨架」悬空。

---

## 4. 可接受的重叠(无需改,但需知晓)

- **对抗性安全测试**在 C2(新写)、C4(复用为 eval 场景)、C6(联调环境重跑)三处出现——属合理复用,但 C4 必须把安全场景**单独标注、不污染回归 baseline**(C4 已注意)。
- **changedFiles / toolCalls 计数**在 C2(安全)与 C3(预算)各一套——属分层设计,按 §3.4 的计数规则即可。

---

## 5. 建议执行顺序

1. C1/C2 接缝已在当前代码中落地,后续文档维护应以 `runtime/session-factory.ts`、`runtime/resource-loader.ts`、`runtime/driver.ts` 的当前实现为准。
2. review、remember、MCP/未知工具 confirm 均已有归属与实现,不要再写成无人认领缺口。
3. 扩展链顺序以 §3.4 为准;特别注意 MCP 仅非 `readonly` 注册。
4. C6 收口项按 §3.5 的测试覆盖口径描述;patch locate 可注明“单测已覆盖,端到端可后续”。
5. 回归验证继续以 `npm run lint`、`npm run test`、`agent eval --provider faux` 等命令为主。

---

## 6. 一句话

7 个周期把「需求 v2 + 技术实现」拆成可独立验收、可演示的垂直切片;支柱切分清晰、与技术文档 §14 里程碑一致。当前代码已经完成关键接缝与 C6 主要硬化项,后续维护重点是保持各周期文档与 §3.4/§3.5 的当前实现口径一致。
