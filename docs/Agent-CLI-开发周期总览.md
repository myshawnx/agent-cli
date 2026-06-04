# Agent CLI 开发周期总览 + 一致性修订(规范层)

> 本文是 7 份周期开发文档的**总纲**。它给出周期划分、依赖图、时间线,并把跨周期一致性评审发现的**缺口/重叠/依赖问题**收敛成一组**规范性修订**——凡本文与某周期草稿冲突处,**以本文为准**。
>
> 周期文档:[C0](dev-cycles/C0-foundation.md) · [C1](dev-cycles/C1-readonly-shell.md) · [C2](dev-cycles/C2-safety-policy.md) · [C3](dev-cycles/C3-loop-trace-diff.md) · [C4](dev-cycles/C4-eval-harness.md) · [C5](dev-cycles/C5-mcp-adapter.md) · [C6](dev-cycles/C6-harden-release.md)
> 源文档:[需求文档 v2](Agent-CLI-需求文档-v2.md) · [技术实现文档](Agent-CLI-技术实现文档.md)

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
| C6 | v1.0 硬化、演示、发布 | 9d | 三支柱联调 + demo + README + 发布 |

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
//   实现:extensionFactories = [policyGateway, loopGuards, traceRecorder, mcpAdapter, ...(opts?.extraFactories ?? [])]

// runtime/session-factory.ts —— 允许注入 provider/model(C4 切 faux/real;默认仍 anthropic)
export function buildSession(opts: {
  cwd: string; mode: ApprovalMode; resourceLoader: ResourceLoader;
  model?: Model;            // ★ 新增:缺省 getModel("anthropic", config.model)
}): Promise<{ session: AgentSession }>;

// runtime/driver.ts —— 预留 usage 订阅接缝(C3 token 软停 / C6 预算硬验证复用,避免反向改 driver)
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

// policy/types.ts —— limits 一次性固化时就带上 commandTimeoutMs(C6 实现超时杀进程,但 schema 不再迁移)
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

- **固定扩展工厂注册顺序**:`policyGateway → loopGuards → traceRecorder → mcpAdapter`。任一返回 `{block:true}` 即短路,**首个 block 的 reason 为准**。
- **计数规则**:被 `policyGateway` deny 的 `tool_call`**不计入** `loopGuards` 的 `maxToolCalls` 预算(写进 C3 验收)。
- **生命周期时序**:`mcpAdapter` 在 `session_start` 注册工具,`policyGateway/loopGuards/traceRecorder` 在 `agent_start` 清零计数。C6 的三支柱联调测试必须**同时覆盖** `session_start` 与 `agent_start` 两类事件的时序,避免错配漏判。

### 3.5 文档口径修正

- `truncateTail(content, opts)` 返回 `TruncationResult`,字段是 **`.content`**(技术文档草稿里的 `.text` 是错的,C5 已更正)。C6 汇编总 README 时不要把旧写法带回。
- `.agent/mcp.json`:由 **C5 的 `agent mcp add` 生成**(运行期),C1 的 `init` 不产出——在 C1 文档显式声明,消除「init 产出 mcp.json 骨架」悬空。

---

## 4. 可接受的重叠(无需改,但需知晓)

- **对抗性安全测试**在 C2(新写)、C4(复用为 eval 场景)、C6(联调环境重跑)三处出现——属合理复用,但 C4 必须把安全场景**单独标注、不污染回归 baseline**(C4 已注意)。
- **changedFiles / toolCalls 计数**在 C2(安全)与 C3(预算)各一套——属分层设计,按 §3.4 的计数规则即可。

---

## 5. 建议执行顺序

1. **先回填接缝**:按 §3.1(C1 三接缝)、§3.2(C2 两预埋)修订 C1/C2 文档与实现。
2. **再认领缺口**:§3.3 把 review→C2、remember→C3、MCP-confirm→C6 写进对应周期。
3. **钉死顺序**:§3.4 写进 C3/C6 验收标准。
4. 之后按 C0→C6 顺序开发;每周期以其文档的「Definition of Done」+「周期演示」为合并门槛。
5. C4 完成后即建立 `baseline.json`,此后每周期收尾都跑一次 `agent eval --provider faux` 防回归。

---

## 6. 一句话

7 个周期把「需求 v2 + 技术实现」拆成可独立验收、可演示的垂直切片;支柱切分清晰、与技术文档 §14 里程碑一致。**唯一的放行前条件是先回填 §3 的 5 个接口接缝与 3 个认领缺口**——做完,这套计划即可按序开工。
