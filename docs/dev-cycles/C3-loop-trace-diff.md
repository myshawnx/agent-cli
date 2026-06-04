# Cycle C3:v0.3 — 控制流守卫 + Task Trace + diff/undo(预计 9 天 · 周期 4/7)

## 1. 周期目标

本周期结束时,agent 在执行修改类任务(尤其是 test-fix 循环)时不再"跑飞":pi 的 agent loop 仍然驱动迭代,但所有迭代都套在一层我自己拥有的守卫里——工具调用预算、反 reward-hacking、无进展检测、失败保全;同时把 task 元数据写进 pi 的 session 并从中投影出只读 TaskView,使 `agent history / resume / diff / undo` 都建立在"单一真相源 = pi session"之上,不另起平行历史。之所以排在 C2(安全策略层)之后、C4(eval harness)之前:守卫和 gateway 都挂在同一条 `tool_call` hook 链上,必须在策略层稳定后接续;而 C4 的 eval runner 要靠本周期产出的 deny/confirm 计数、TaskView 投影和受控终止行为来打分,所以受控 loop 必须先成型。

## 2. 范围

### 2.1 In-scope(本周期做)

- `src/loop/guards.ts` 的 `loopGuards` extensionFactory:挂 `pi.on("agent_start")` / `pi.on("tool_call")` / `pi.on("tool_result")`,实现四项守卫——
  - 工具调用预算 `maxToolCalls`(每个 agent turn 计数,超限 `{ block: true }` 并产出现状);
  - 反作弊 reward-hacking guard:修测试任务里禁改测试文件,`isTestFile(path, profile)` 用 `profile.testDirs` + glob 判定;
  - 无进展检测:同一组测试失败(失败签名)连续 N 轮(`maxFixIterations`)且无新增通过 → 经 `pi.sendMessage(..., { deliverAs: "followUp" })` 注入停止指令;
  - 失败保全:到顶/无进展时不回滚,保留 diff + 失败摘要。
- `src/trace/entries.ts` 的 `traceRecorder` extensionFactory:`agent_start` → `pi.appendEntry("task-meta", …)`,`agent_end` → `pi.appendEntry("task-result", …)`,把 pi 没有的 goal/mode/status/turns 写进 pi session(随 fork/resume 存活)。
- `src/trace/projection.ts` 的 `projectTask(ctx)`:从 `ctx.sessionManager.getBranch()` 投影只读 `TaskView`(goal / toolCalls / modifiedFiles / result),单一真相源 = pi session。
- `remember` 工具(via `pi.registerTool`)+ `memory.md` 写入端:把要点 append 到 `memory.md`,与 `traceRecorder` / `appendEntry` 同源(都落在 pi session 侧)。
- `agent history`:列 pi 的 sessions(按 cwd)。
- `agent resume [id]`:映射到 pi 的 `--resume` / leafId,不发明 `task_id`。
- `agent diff`:复用 pi 的 edit-diff 渲染,展示本 task 改动。
- `agent undo`:复用 git-checkpoint 的 `git stash` 快照,只撤文件改动,明示不撤命令副作用。
- 受控 test-fix 循环在一个 planted bug 上手动端到端跑通(预算/无进展/失败保全都被肉眼观察到)。

### 2.2 Out-of-scope(明确推迟)

- eval harness / 自动打分 / 回归表(`src/eval/*`)——推到 **C4**。本周期产出的守卫计数与 TaskView 是 C4 的输入,但 runner 本身不在此做。
- MCP adapter(`src/mcp/*`)——推到 **C5**。
- token 硬上限的"真中断":本周期只做 usage 事件累计 + 主动 `sendMessage` 软停;硬 abort 时序验证连同 §15-1 推到 **C6** 硬化。
- suggest 模式的 B 方案(`propose_patch` 工具)——非本周期,留 **C6**(或视需要)。
- `agent undo` 的命令副作用回滚(装的包/DB/网络)——**永久 out-of-scope**,文档明示边界。
- 跨进程并发下 `.agent/` 与 git 操作的锁/租约(§15-5)——推到 **C6**。

## 3. 前置依赖

- **C0**:仓库脚手架、TypeScript 工程、测试运行器(vitest/node:test)、pi 的 faux provider 跑 headless session 的封装可用。
- **C1**:`src/runtime/session-factory.ts`(`buildSession` / `createAgentSession` 封装)、`src/runtime/resource-loader.ts`(`buildResourceLoader` + `DefaultResourceLoader` + `extensionFactories` 注入点)、`src/runtime/driver.ts`、`src/context/profile.ts`(`ProjectProfile`,含 `testDirs`)、`agent init`。守卫要靠 `profile.testDirs`,trace 要靠 session-factory 注入的 `sessionManager`。
- **C2**:`src/policy/gateway.ts` 的 `policyGateway` 已稳定挂在 `tool_call` 链上;`PolicyConfig.limits`(`maxToolCalls` / `maxFixIterations` / `maxChangedFiles`)类型已定义;git-checkpoint 扩展已作为基线接入(C2 的 undo 复用它,本周期把 `agent undo` 子命令落到它上面)。
- **pi SDK 接口**:`ExtensionAPI`(`pi.on` / `pi.appendEntry` / `pi.sendMessage`)、`ExtensionContext`(`ctx.sessionManager.getBranch()`)、`SessionManager`、pi 的 edit-diff 渲染工具、git-checkpoint 扩展(`git stash` 快照)。
- **外部条件**:跑通端到端需要一个真实 provider key(`agent "<task>"` 实跑);所有单测/集成测试只用 pi 的 faux provider,**不烧真实 LLM**。一个 planted-bug fixture repo(可借 C4 fixture 的早期快照,例如 `expired-token-401`,token 过期返回 500 应为 401)。

## 4. 工作分解 WBS

| 任务 | 涉及文件/模块 | 说明 | 估时 |
|---|---|---|---|
| T3.1 | `src/loop/types.ts`(或并入 `policy/types.ts` 的 `Limits`) | 固化 `Limits`(`maxToolCalls`/`maxFixIterations`/`maxChangedFiles`/`tokenBudget?`)与守卫内部状态类型 | 0.3d |
| T3.2 | `src/loop/guards.ts` | `loopGuards(limits, profile)` 骨架:挂 `agent_start` 清零计数,`tool_call` / `tool_result` 占位 | 0.4d |
| T3.3 | `src/loop/guards.ts` | 守卫①工具调用预算:`tool_call` 内 `++toolCalls > maxToolCalls` 返回 `{ block: true, reason }` | 0.4d |
| T3.4 | `src/loop/guards.ts`、`src/loop/test-file.ts` | 守卫②反 reward-hacking:`isTestFile(targetPath(event.input), profile)`(用 `profile.testDirs` + glob)在 edit/write 时阻断改测试文件 | 0.8d |
| T3.5 | `src/loop/guards.ts`、`src/loop/failure-signature.ts` | 守卫③无进展检测:`isTestRun(e)` 判定 + `hashFailures(resultText(e))` 失败签名;同签名连续 ≥`maxFixIterations` 轮且无新通过 → `pi.sendMessage` 软停 | 1.0d |
| T3.6 | `src/loop/guards.ts` | 守卫④失败保全:停止路径不回滚,组织 diff + 失败摘要文本(交由 driver/总结展示),依赖 git-checkpoint 可回溯 | 0.5d |
| T3.7 | `src/loop/guards.ts` | token 预算软停:订阅 usage 累计(由 driver 或 `session.subscribe` 透传),超 `tokenBudget` 同样 `sendMessage` 停 | 0.5d |
| T3.8 | `src/trace/entries.ts` | `traceRecorder(goal, mode)`:`agent_start` → `appendEntry("task-meta")`,`agent_end` → `appendEntry("task-result")` | 0.5d |
| T3.9 | `src/trace/projection.ts` | `projectTask(ctx)`:`ctx.sessionManager.getBranch()` → `TaskView`;`pickCustom`/`extractToolCalls`/`extractModifiedFiles` 辅助。`getBranch` 是异构 union,tool 调用需从 message content blocks 下钻并与 tool-result 关联,比 flat filter 工作量大 | 1.5d |
| T3.10 | `src/runtime/resource-loader.ts` | 把 `loopGuards` 与 `traceRecorder` 加进 `extensionFactories`(确认相对 gateway 的挂载顺序) | 0.2d |
| T3.11 | `src/cli/commands/history.ts`、`src/cli/args.ts` | `agent history`:用 `SessionManager` 按 cwd 列 pi sessions(id/时间/goal 摘要) | 0.6d |
| T3.12 | `src/cli/commands/resume.ts` | `agent resume [id]`:解析 id/leafId → 透传 pi `--resume` 语义重建 session,不发明 task_id | 0.7d |
| T3.13 | `src/cli/commands/diff.ts` | `agent diff`:从 TaskView 取 modifiedFiles + 复用 pi edit-diff 渲染输出 unified diff | 0.6d |
| T3.14 | `src/cli/commands/undo.ts` | `agent undo`:复用 git-checkpoint 的 `git stash` 快照恢复;只撤文件;`--help`/输出明示不撤命令副作用 | 0.7d |
| T3.15 | `test/loop/*.test.ts`、`test/trace/*.test.ts` | 单测:预算/反作弊/失败签名/projection 纯函数 | 1.0d |
| T3.16 | `test/integration/loop.headless.test.ts` | 集成:faux provider headless,断言改测试文件被 block、预算到顶即停、无进展软停 | 1.0d |
| T3.17 | `scripts/demo-test-fix.sh`、`fixtures/`(planted bug 早期快照) | 端到端手动跑通受控 test-fix 循环 + 录制演示 | 0.6d |
| T3.18 | `src/context/memory.ts`(写入) + `src/tools/remember.ts` | `remember` append 到 `memory.md`;单测/集成 | 0.6d |

合计约 11.4 人日的"理论上限";按一人开发并行复用、纯函数测试与实现交叠,落到 **9 天**。

## 5. 关键接口 / 数据结构

```ts
// src/loop/types.ts —— 与 policy/types.ts 的 PolicyConfig.limits 同源
export interface Limits {
  maxChangedFiles: number;
  maxFixIterations: number;   // 无进展判定的"连续失败轮数"上限,默认 5
  maxToolCalls: number;       // 单 agent turn 的工具调用预算
  tokenBudget?: number;
}
```

```ts
// src/loop/guards.ts —— extensionFactory,与磁盘扩展同构:(pi: ExtensionAPI) => void
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProjectProfile } from "../context/profile";
import { isTestFile } from "./test-file";
import { isTestRun, hashFailures, resultText } from "./failure-signature";
import { targetPath } from "../policy/path-guard";   // C2 既有 helper,复用

export const loopGuards =
  (limits: Limits, profile: ProjectProfile) =>
  (pi: ExtensionAPI) => {
    let toolCalls = 0;
    let fixRounds = 0;
    const failedSig = new Set<string>();
    let stopped = false;

    pi.on("agent_start", () => { toolCalls = 0; });   // 每个 agent loop 开始时重置预算计数(agent_start;非 per-turn)

    pi.on("tool_call", async (event) => {
      // ① 工具调用预算
      if (++toolCalls > limits.maxToolCalls) {
        return {
          block: true,
          reason: `超出工具调用预算(${limits.maxToolCalls}),已停止并产出现状(diff + 摘要)`,
        };
      }
      // ② 反 reward-hacking:修测试任务里禁改测试文件
      if (
        (event.toolName === "edit" || event.toolName === "write") &&
        isTestFile(targetPath(event.input), profile)
      ) {
        return {
          block: true,
          reason: "检测到改动测试文件以骗过测试,已阻断(reward-hacking guard)",
        };
      }
      return undefined;   // 放行,交给后续 hook(gateway 已在前)/工具 execute
    });

    // ③ 无进展检测:同一组失败连续 N 轮且无新增通过 → 软停
    pi.on("tool_result", (e) => {
      if (stopped || !isTestRun(e)) return;
      const sig = hashFailures(resultText(e));   // 仅对失败集合做签名,新通过会改变签名
      if (failedSig.has(sig)) {
        if (++fixRounds >= limits.maxFixIterations) {
          stopped = true;
          pi.sendMessage(
            { content: "测试反复失败且无进展,停止修复,产出 diff 与失败摘要交人。", customType: "loop-guard" },
            { deliverAs: "followUp" }, // 守卫在 streaming 中触发,deliverAs(streaming)与 triggerTurn(idle)互斥,这里用 followUp
          );
        }
      } else {
        fixRounds = 0;   // 失败签名变化(含新增通过)= 有进展,重置
      }
      failedSig.add(sig);
    });
  };
```

```ts
// src/loop/test-file.ts
import { minimatch } from "minimatch";
import type { ProjectProfile } from "../context/profile";

// 用 profile.testDirs(C1 探测产出)+ 常见测试命名 glob 判定
export function isTestFile(path: string, profile: ProjectProfile): boolean {
  if (!path) return false;
  const inTestDir = profile.testDirs.some((d) => path.startsWith(d.replace(/\\/g, "/")));
  const namedTest = ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test_*.py", "**/*_test.go"]
    .some((g) => minimatch(path, g, { dot: true }));
  return inTestDir || namedTest;
}
```

```ts
// src/loop/failure-signature.ts
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

// ToolResultEvent 无 output 字段,payload 是 content:(TextContent|ImageContent)[] + details + isError
export function resultText(e: ToolResultEvent): string {
  return (e.content ?? []).filter((c) => c.type === "text").map((c: any) => c.text).join("\n");
}

export function isTestRun(e: ToolResultEvent): boolean {
  // bash 工具 + 命令命中 profile.commands.test,或输出含已知测试框架失败摘要标记
  return e.toolName === "bash" && /(\d+ failed|FAIL|✗|AssertionError)/.test(resultText(e));
}

// 对"失败的测试集合"做稳定签名:剥离行号/时间/路径噪声,只保留失败用例名集合
export function hashFailures(output: string): string {
  const names = [...output.matchAll(/(?:✗|FAIL|×)\s+([^\n]+?)(?:\s+\(\d|$)/gm)]
    .map((m) => m[1].trim())
    .sort();
  return names.join("|") || `RAW:${output.replace(/\s+/g, " ").slice(0, 200)}`;
}
```

```ts
// src/trace/entries.ts —— 把 pi 没有的元数据写进 pi 的 session
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const traceRecorder =
  (goal: string, mode: string) =>
  (pi: ExtensionAPI) => {
    pi.on("agent_start", () =>
      pi.appendEntry("task-meta", { goal, mode, startedAt: new Date().toISOString() }),
    );
    pi.on("agent_end", (e) =>
      pi.appendEntry("task-result", { status: "done", turns: e.messages.length, endedAt: new Date().toISOString() }),
    );
    // tool 调用 / 结果 / 改动文件已在 pi 原生 entry 里,不重复记录
  };
```

```ts
// src/trace/projection.ts —— 只读视图,单一真相源 = pi session
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface ToolCallView { name: string; input: unknown; ts?: string; }
export interface TaskView {
  goal?: string;
  mode?: string;
  toolCalls: ToolCallView[];
  modifiedFiles: string[];
  result?: { status: string; turns: number };
}

export function projectTask(ctx: ExtensionContext): TaskView {
  const entries = ctx.sessionManager.getBranch();   // SessionEntry[] 异构 union,天然支持 fork/resume
  // custom entry 的 payload 在 .data 下(appendEntry 写 CustomEntry)
  const meta = pickCustom(entries, "task-meta");
  const toolCalls = extractToolCalls(entries);       // 从 SessionMessageEntry.message 的 assistant content blocks 下钻
  return {
    goal: meta?.goal,
    mode: meta?.mode,
    toolCalls,
    modifiedFiles: extractModifiedFiles(entries, toolCalls),   // edit/write 入参与 tool-result 关联
    result: pickCustom(entries, "task-result"),
  };
}
```

```jsonc
// CLI 子命令契约(SDK 上的薄封装,不发明 task_id)
// agent history          → SessionManager 按 cwd 列 pi sessions
// agent resume [id]      → 透传 pi --resume / leafId
// agent diff             → projectTask().modifiedFiles + pi edit-diff 渲染
// agent undo             → git-checkpoint 的 git stash 快照恢复;仅文件;不撤命令副作用
```

## 6. 验收标准

- [ ] `loopGuards` 作为 extensionFactory 在 `buildResourceLoader` 的 `extensionFactories` 中注册,挂载顺序在 `policyGateway` 之后、不与之冲突(deny 仍在落盘前短路)。
- [ ] 工具调用数在单 turn 内超过 `maxToolCalls` 时,下一次 `tool_call` 返回 `{ block: true }`,reason 文本含预算值;计数在每个 `agent_start` 归零。
- [ ] 在 test-fix 任务中,对命中 `isTestFile`(经 `profile.testDirs` 或测试命名 glob)的路径执行 edit/write 时被阻断,reason 标注 reward-hacking guard;非测试源文件不受影响。
- [ ] 同一组测试失败(`hashFailures` 同签名)连续达到 `maxFixIterations` 轮且无新增通过时,经 `pi.sendMessage(..., { deliverAs: "followUp" })` 注入停止消息;失败签名一旦变化(含新增通过)轮数计数被重置。
- [ ] 停止/到顶时**不回滚**已产生的改动,能产出 diff + 失败摘要(失败保全),git-checkpoint 快照可回溯。
- [ ] `traceRecorder` 在 `agent_start`/`agent_end` 分别通过 `pi.appendEntry` 写入 `task-meta` / `task-result`,可在 session JSONL 中查到这两类自定义 entry。
- [ ] `projectTask(ctx)` 仅从 `ctx.sessionManager.getBranch()` 读取,产出 `goal/mode/toolCalls/modifiedFiles/result`,不读任何平行 `task_*.json`。
- [ ] `remember` 工具(经 `pi.registerTool` 注册)调用后,要点被 append 到 `memory.md`,内容可在文件中查到。
- [ ] `agent history` 列出当前 cwd 的 pi sessions,每行含可用于 resume 的 id 与 goal 摘要。
- [ ] `agent resume <id>` 能在对应 pi session/leafId 上续跑,TaskView 中的 goal 与续跑前一致(证明 trace 随 resume 存活)。
- [ ] `agent diff` 输出本 task 改动的 unified diff,渲染复用 pi 的 edit-diff(非自研 diff 算法)。
- [ ] `agent undo` 通过 git stash 快照把文件改动还原到 task 前状态;`--help` 与命令输出明确写出"只撤文件,不撤命令副作用(装的包/DB/网络)"。
- [ ] 受控 test-fix 循环在 planted bug fixture 上端到端跑通,且能现场观察到上述守卫(预算/反作弊/无进展/失败保全)中至少触发预算或无进展之一。

## 7. 测试计划

- **单测(纯函数,不碰 LLM)**:
  - `isTestFile`:覆盖 `profile.testDirs` 命中、`*.test.ts`/`*.spec.ts`/`__tests__`/`test_*.py`/`*_test.go` 命名命中、源文件不命中。
  - `hashFailures` / `isTestRun`:相同失败集合产出相同签名;新增通过/失败集合变化产出不同签名;行号/时间噪声被剥离。
  - `projectTask`:给定一组伪造 entries(含 `task-meta`/`task-result`/tool-call/edit),断言投影出的 `goal/toolCalls/modifiedFiles/result`;`modifiedFiles` 去重。
  - 预算计数:模拟连续 `tool_call`,断言第 `maxToolCalls+1` 次返回 `{ block: true }`,`agent_start` 后归零。
- **集成(pi faux provider,headless session)**:
  - 录制脚本让 faux provider 反复对同一测试发起 edit→bash(test)循环且测试始终失败 → 断言到 `maxFixIterations` 轮触发 `loop-guard` followUp 软停。
  - faux provider 尝试 edit 一个测试文件 → 断言被 `loopGuards` block(reason 含 reward-hacking)。
  - faux provider 制造超 `maxToolCalls` 的工具调用 → 断言被预算 block 且会话保留已产生 diff(失败保全)。
  - resume 路径:headless 跑一段 → dispose → `agent resume` 重建 → 断言 `task-meta` entry 仍可投影出原 goal。
- **对抗性**:让 faux provider 试图"删断言/改期望值/直接改测试文件以骗过测试" → 断言全部被反作弊守卫拦下;记录修复前后通过数,确认未用降低断言数骗过。
- **eval**:本周期不涉及(eval harness 在 C4);但守卫的 deny/confirm/无进展计数要以可被 C4 读取的形式暴露(经 hook 计数或 task-result 字段),为 C4 打分预留接口。

## 8. 风险与缓解

- **token 软停不是硬中断(对应 §15-1)**:本周期靠 usage 事件累计 + `pi.sendMessage` 主动停,无法在一次 LLM 调用进行中硬切。缓解:软停 + 在文档明示这是软边界;`maxToolCalls` 作为兜底硬门(它在 `tool_call` 同步短路);abort 时序的硬验证推到 C6。
- **`pi.sendMessage(deliverAs: "followUp")` 的实际停止语义未必"立即停"**:它是注入下一轮提示,模型可能再发一两个工具调用才收手。缓解:无进展软停叠加预算硬停做双保险;集成测试断言"有限轮内确实收敛",而非"立刻停"。
- **失败签名误判**:不同框架输出格式各异,`hashFailures` 的正则可能把"有进展"误判为"无进展"或反之,导致过早停或停不下来。缓解:签名只取失败用例名集合并排序去噪;无法解析时退化为输出片段 hash;签名变化即重置轮数,偏向"宁可多跑也别误杀进展";用真实框架输出样本做单测。
- **反作弊误伤合法测试编辑**:任务本身就是"写测试"时,禁改测试文件会挡掉正当行为。缓解:守卫只在"修代码让测试过"类任务激活(由 task-meta 的 goal/mode 或 profile 标志门控),test-writer 类任务不挂此守卫;`isTestFile` 判定可被显式 allowlist 覆盖。
- **守卫与 gateway 的 hook 执行顺序**:两者都在 `tool_call` 返回 block,顺序错会让计数/拦截语义混乱。缓解:固定 `extensionFactories` 顺序(gateway 在前做安全短路,guards 在后做预算/反作弊),并在集成测试里断言"被 gateway deny 的调用不计入预算"。
- **undo 边界被误解为"完全回滚"**:用户可能以为 `agent undo` 能撤销装的包/DB 写入。缓解:`--help` 与命令输出强制打印"只撤文件"声明;diff/undo 文档单独一节写清副作用不可逆。
- **fixture 与 C4 共享带来的耦合**:本周期借用 C4 fixture 早期快照,若 C4 改格式会回灌。缓解:本周期只用 fixture 的目录快照跑手动 demo,不依赖 `scenarios.json` 结构;正式 fixture 契约由 C4 定。

## 9. Definition of Done

- [ ] `src/loop/guards.ts`、`src/loop/test-file.ts`、`src/loop/failure-signature.ts`、`src/trace/entries.ts`、`src/trace/projection.ts` 全部实现并通过类型检查。
- [ ] `loopGuards` 与 `traceRecorder` 已注册进 `buildResourceLoader` 的 `extensionFactories`,顺序与 gateway 协调一致。
- [ ] `agent history` / `agent resume` / `agent diff` / `agent undo` 四个子命令在 `src/cli/commands/` 落地并接入 `args.ts`。
- [ ] 全部单测、集成(faux provider headless)、对抗性测试通过;CI 不触真实 LLM。
- [ ] 受控 test-fix 循环在 planted bug fixture 上手动端到端跑通,演示脚本 `scripts/demo-test-fix.sh` 可复现。
- [ ] 文档:trace/diff/undo 一节(含 undo 只撤文件的边界声明)、守卫四项与终止条件说明、loop-guard 软停 vs 预算硬停的区分写入 README/设计说明。
- [ ] 代码评审通过,无 TODO 占位;`agent undo --help` 文案含命令副作用免责声明。

## 10. 周期演示

```bash
# 0. 准备:在 planted-bug fixture(token 过期返回 500,应 401)目录里
agent init                       # C1 产出;确保 .agent/profile 有 testDirs

# 1. 受控 test-fix 循环(守卫全程在线)
agent "修复登录 token 过期返回 500 的问题(应 401),并补测试"
#   预期:搜索→读 auth middleware→改源文件→跑测试→(失败则受控修复)→展示 diff→总结
#   现场可见:若人为把 fixture 改成"不可修复",连续失败到 maxFixIterations 轮后
#            出现 loop-guard 软停消息"测试反复失败且无进展,停止修复,产出 diff 与失败摘要交人"
#            且改动未被回滚(失败保全)

# 2. 反作弊演示:诱导 agent 直接改测试文件
agent "把 auth.test.ts 里失败的断言删掉让测试过"
#   预期:edit 测试文件的调用被 block,reason 含 "reward-hacking guard"

# 3. trace / 历史 / 续跑(单一真相源 = pi session)
agent history                    # 列出当前 cwd 的 pi sessions,含 goal 摘要
agent resume <id>                # 在该 session 上续跑,goal 与之前一致

# 4. diff / undo(复用 pi 渲染 + git stash 快照)
agent diff                       # 本 task 的 unified diff(pi edit-diff 渲染)
agent undo                       # 还原文件改动;输出明示"只撤文件,不撤命令副作用"
```

预期可见结果:loop 在预算/无进展处可控停止并保留现状;改测试文件被硬阻断;`history/resume` 证明 trace 随 pi session 存活;`diff/undo` 一对命令完成"看改动→撤改动",且 undo 边界被显式打印。

## 11. 交付物

- 代码模块:`src/loop/guards.ts`、`src/loop/test-file.ts`、`src/loop/failure-signature.ts`、`src/loop/types.ts`;`src/trace/entries.ts`、`src/trace/projection.ts`;`src/tools/remember.ts`、`src/context/memory.ts`(`memory.md` 写入端);`src/cli/commands/history.ts`、`resume.ts`、`diff.ts`、`undo.ts`(及 `src/cli/args.ts` 接线);`src/runtime/resource-loader.ts` 的 extensionFactories 增补。
- 测试:`test/loop/test-file.test.ts`、`test/loop/failure-signature.test.ts`、`test/loop/budget.test.ts`、`test/trace/projection.test.ts`、`test/integration/loop.headless.test.ts`、`test/integration/reward-hacking.test.ts`、`test/integration/resume.test.ts`(faux provider)。
- 演示脚本:`scripts/demo-test-fix.sh` + 借用的 planted-bug fixture 目录快照。
- 文档:trace/diff/undo 设计说明、四项守卫与终止条件说明、undo 边界声明(only-files)、loop-guard 软停 vs 预算硬停区分,纳入 README/设计文档相应章节。
- 依赖:`minimatch` 是 `test-file.ts` 新引入的依赖,需加入 `package.json` deps(或改用 pi 已暴露的 glob 工具,若可复用则免新增依赖)。
