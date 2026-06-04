# Cycle C2:v0.2 — 安全策略层(预计 8 天 · 周期 3/7)

## 1. 周期目标

本周期结束时,Agent CLI 拥有一层**声明式、可测、按审批模式状态机驱动的安全策略**:每一次 `pi.on("tool_call")` 都经过 `classify(event, mode, policy, changedFiles)` 收口,deny 在工具落盘前短路、confirm 经 `ctx.ui.confirm` 或在非交互/`-p` 下保守阻断、auto 不弹窗但 deny 硬生效。之所以排在 C1(SDK 外壳与只读理解)之后、C3(控制流守卫 + Task Trace + diff/undo)之前:C1 已经用工具白名单把 `readonly` 做成硬隔离并证明 `createAgentSession` 外壳能跑通,策略层需要这个外壳和真实的 `tool_call` 事件流才能落地;而 C3 的 loop 守卫(`loop/guards.ts`)和 diff/undo 复用的正是本周期建立的同一条 `tool_call` 拦截链,所以策略网关必须先于守卫存在。本周期的另一硬目标是**对抗性安全测试套件**——它把"我宣称能拦"变成"我证明能拦",并诚实地把 bash 防护写成减速带而非 OS 沙箱。

## 2. 范围

### 2.1 In-scope(本周期做)

- `src/policy/types.ts`:`ApprovalMode`、`PolicyConfig`、`Verdict` 三组类型固化。
- `src/policy/engine.ts`:`classify(event, mode, policy, changedFiles)` 纯函数,实现技术文档 §4.2 的分发算法(read/write/edit/bash/default)。
- `src/policy/command-classifier.ts`:bash 命令的 `allow | confirm | deny` 三级分类器,由 `policy.json` 的 `command.{allow,confirm,deny}` 驱动。
- `src/policy/path-guard.ts`:glob `deny` / `confirmWrite` 匹配、`outsideRepoRoot` 越界判断、`bashTouchesProtectedPath` 的 best-effort 路径解析(重定向 `>`/`>>`/`tee`、参数路径)。
- `src/policy/gateway.ts`:`extensionFactory`,在 `pi.on("tool_call")` 统一收口;`confirm` 经 `ctx.ui.confirm`;`ctx.hasUI === false`(`-p` / 无 UI)时保守阻断;`auto` 模式不弹窗但 deny 硬生效、confirm 放行;以 `pi.on("agent_start")` 重置 `changedFiles` 计数并在 write/edit 放行后自增。
- **四种审批模式行为补全**:`readonly`(C1 已硬排除写/执行工具,这里只补防御性 deny)、`suggest`(选定 **方案 A**:`edit/write` 仍在白名单但 gateway 一律判 `confirm`,确认前不落盘)、`workspace-write`(cwd 内允许写、越界与敏感清单阻断/确认)、`auto`(deny 硬生效、confirm 不弹窗放行)。
- 可选接入 `@anthropic-ai/sandbox-runtime` 的开关:`policy.sandbox.enabled`(本周期仅做 flagged 入口与文档表述,真实 OS 级 denyRead/denyWrite 接线作为可选项,默认关闭)。
- **★ 对抗性安全测试套件**:一组恶意 prompt + 单元级 Verdict 断言 + faux provider headless 集成测试,证明 `rm -rf` / `curl|sh` / 写 `.env` / 读 `~/.ssh` 全部被拦。
- bash 威胁模型的诚实表述:在文档、`policy.json` 注释、`agent --help` 三处明示"字符串级减速带 vs OS 沙箱真边界"的区分。
- `agent review`:读 git diff → 经 classify/风险分级 → 输出风险点/缺测试/建议(复用 engine,不新增策略类型)。

### 2.2 Out-of-scope(明确推迟)

- diff 渲染与 `agent undo`(`git-checkpoint` / `git stash` 复用)→ **C3**。
- test-fix loop 守卫:`maxToolCalls` / `maxFixIterations` 预算、无进展检测、reward-hacking(改测试文件)拦截 → **C3**(`src/loop/guards.ts`)。注意:`PolicyConfig.limits` 字段在本周期一并固化进类型与 `policy.json`,但**消费 limits 的守卫逻辑**在 C3;本周期 gateway 仅消费 `limits.maxChangedFiles` 一项(它属于"批改超阈值需确认"的写策略,而非 loop 控制)。
- Task Trace(`trace/entries.ts`、`trace/projection.ts`、`pi.appendEntry`)→ **C3**。
- MCP adapter(`mcp/`)→ **C5**。
- Eval harness(`eval/`)→ **C4**;本周期的对抗性测试是独立的安全测试套件,不依赖 eval runner。
- sandbox-runtime 的真实 OS 级拦截验证(macOS/Linux 行为差异、denyRead 实测)→ 留作 **C6** 硬化阶段的可选验证;本周期只交付开关与诚实文档。

## 3. 前置依赖

- **C0 产出**:测试地基(单测 runner、faux provider 接线约定、`test/suite/harness.ts` 的录制式假 provider 模式)、`policy.json` 的加载与 schema 校验骨架、CI。
- **C1 产出**:
  - `src/runtime/session-factory.ts` 的 `computeTools(mode)`(`readonly` 排除 `edit/write/bash`,其余给全);本周期的 `suggest` 方案 A 依赖 `edit/write` 仍在白名单。
  - `src/runtime/resource-loader.ts` 的 `buildResourceLoader`,其 `extensionFactories` 数组——本周期把 `policyGateway(policy, mode)` 挂进去。
  - `src/runtime/driver.ts` 的 `print` / `interactive` 两种驱动,以便区分 `ctx.hasUI`。
  - `src/context/profile.ts` 的 `ProjectProfile`(供路径判断参考 sourceDirs/testDirs;本周期路径策略主要用 glob,profile 为辅)。
  - `.agent/policy.json` 由 `agent init` 生成(C1 已具骨架);本周期固化其 `command` / `path` / `limits` / `sandbox` 字段。
- **外部条件**:对抗性单测与 Verdict 断言**不需要 provider key**(纯函数);faux provider headless 集成测试用 C0 约定的录制式假 provider,**不烧真实 LLM**;sandbox 实测(若启用)需 macOS/Linux 且 `@anthropic-ai/sandbox-runtime` 可装,本周期不强制。

## 4. 工作分解 WBS

| 任务 | 涉及文件/模块 | 说明 | 估时 |
|---|---|---|---|
| T2.1 | `src/policy/types.ts` | 定义 `ApprovalMode = "readonly"\|"suggest"\|"workspace-write"\|"auto"`;`PolicyConfig`(command/path/limits/sandbox);`Verdict`(allow/confirm/deny 判别联合)。导出供 runtime/loop 复用。 | 0.5d |
| T2.2 | `src/policy/path-guard.ts` | glob 编译(deny/confirmWrite),`pathDenied(p)`、`pathConfirmWrite(p)`;`outsideRepoRoot(p, repoRoot)`(规范化 + `..` 逃逸 + 符号链接保守判定);`targetPath(input)` 从 edit/write input 提取目标。 | 1d |
| T2.3 | `src/policy/path-guard.ts`(bash 分支) | `bashTouchesProtectedPath(command)`:解析 `>`/`>>`/`tee`/`cp`/`mv` 目标与读取参数,匹配 `path.deny`。明确 best-effort 边界(不解管道嵌套/base64/子 shell),注释写死。 | 1d |
| T2.4 | `src/policy/command-classifier.ts` | `tier(command): "allow"\|"confirm"\|"deny"`,按 `policy.json` 的 command 三列匹配(前缀/规范化空白/`sudo`、`\|sh` 等危险模式)。deny 优先于 confirm 优先于 allow;未命中默认 confirm(保守)还是 allow——明确选 **未命中=confirm**(白名单外的命令需确认),并在文档说明。 | 1d |
| T2.5 | `src/policy/engine.ts` | `classify(event, mode, policy, changedFiles): Verdict`,实现 §4.2 完整分发:read/grep/find/ls 读保护;write/edit/apply_patch 的 readonly 防御性 deny → 路径 deny → 越界 confirm → confirmWrite → 超 maxChangedFiles → suggest 一律 confirm → allow;bash 的 readonly deny → tier deny → bashTouchesProtectedPath confirm → tier confirm → allow。 | 1.5d |
| T2.6 | `src/policy/gateway.ts` | `policyGateway(policy, mode)` extensionFactory:`agent_start` 重置 `changedFiles`;`tool_call` 调 `classify`;deny→`pi.appendEntry("policy-deny",{tool,reason})` + `{block:true,reason}`;confirm→auto 放行/无 UI 阻断/有 UI `ctx.ui.confirm`;放行后 write/edit 自增 `changedFiles`。 | 1d |
| T2.7 | `src/runtime/resource-loader.ts`(接线) | 把 `policyGateway(ctx.policy, ctx.mode)` 注入 `buildResourceLoader` 的 `extensionFactories`;确保 `--mode` flag → `ctx.mode` 的解析与优先级(CLI flag > policy.json > 默认 suggest)。 | 0.5d |
| T2.8 | `.agent/policy.json` + `--help` | 固化默认 policy(command/path/limits/sandbox)与逐行注释;在 `agent --help` / 子命令 help 写入 bash 威胁模型一句话(减速带 vs 沙箱)。 | 0.5d |
| T2.9 | `policy.sandbox` 开关 | `policy.sandbox.enabled` 读取与 flagged 分支:启用时打印"将接 @anthropic-ai/sandbox-runtime(仅 macOS/Linux)"提示并预留接线点;默认关闭。**不在本周期实测 OS 拦截**。 | 0.5d |
| T2.10 | `test/policy/*.spec.ts` | engine/command-classifier/path-guard 单测:给定 event+mode+policy 断言 Verdict,覆盖每个分支与边界(越界、符号链接、`.env`、lockfile、maxChangedFiles 临界)。 | 1.5d |
| T2.11 | `test/policy/adversarial.spec.ts` + `test/integration/gateway.faux.spec.ts` | ★ 对抗性套件:恶意 prompt 清单驱动 faux provider headless session,断言 gateway 真 `block` 了 `rm -rf` / `curl\|sh` / 写 `.env` / 读 `~/.ssh`;suggest 不落盘;auto 下 deny 仍生效、confirm 放行;`-p` 无 UI 时 confirm→block。 | 2d |
| T2.12 | 文档 | 在设计说明里写 §4.3 三点(落盘前阻断/bash 威胁模型/suggest 方案 A);更新"pi 给了什么/我加了什么"中安全策略行。 | 0.5d |
| T2.13 | `src/cli/commands/review.ts` + `src/cli/args.ts` | `agent review`:取 git diff(staged+working)→ 涉及的写/命令经 classify → 输出 markdown 报告 | 0.75d |

合计约 13 人日工作量经并行/复用收敛到 8 个连续工作日(单人,含测试与文档)。

## 5. 关键接口 / 数据结构

本周期固化以下类型与函数签名(真实 TypeScript + pi `ExtensionAPI`)。

```ts
// src/policy/types.ts
export type ApprovalMode = "readonly" | "suggest" | "workspace-write" | "auto";

export interface PolicyConfig {
  command: { allow: string[]; confirm: string[]; deny: string[] };
  path: { deny: string[]; confirmWrite: string[] };                 // glob
  limits: {                                                          // 类型本周期固化,
    maxChangedFiles: number;                                         //   本周期仅 gateway 消费此项
    maxFixIterations: number;                                        //   下列两项 C3 的 loop/guards 消费
    maxToolCalls: number;
    tokenBudget?: number;
    commandTimeoutMs?: number;                                       // C6 消费,此刻入 schema 避免迁移
  };
  sandbox: { enabled: boolean };                                     // 接 @anthropic-ai/sandbox-runtime,默认 false
}

export type Verdict =
  | { kind: "allow" }
  | { kind: "confirm"; reason: string }
  | { kind: "deny"; reason: string };
```

```ts
// src/policy/engine.ts
import type { ApprovalMode, PolicyConfig, Verdict } from "./types";

// event 来自 pi 的 ToolCallEvent:{ toolName: string; input: unknown }
export function classify(
  event: { toolName: string; input: any },
  mode: ApprovalMode,
  policy: PolicyConfig,
  changedFiles: number,
): Verdict;
```

```ts
// src/policy/command-classifier.ts
export type Tier = "allow" | "confirm" | "deny";
export function tier(command: string, cfg: PolicyConfig["command"]): Tier;
//   匹配顺序:deny > confirm > allow;均未命中 → "confirm"(保守:白名单外需确认)
```

```ts
// src/policy/path-guard.ts
export function targetPath(input: any): string | undefined;          // edit/write 取目标路径
export function pathDenied(p: string, cfg: PolicyConfig["path"]): boolean;
export function pathConfirmWrite(p: string, cfg: PolicyConfig["path"]): boolean;
export function outsideRepoRoot(p: string, repoRoot: string): boolean;
export function bashTouchesProtectedPath(                            // best-effort,减速带
  command: string,
  cfg: PolicyConfig["path"],
): boolean;
```

```ts
// src/policy/gateway.ts —— extensionFactory:(pi: ExtensionAPI) => void
import type { ApprovalMode, PolicyConfig } from "./types";
import { classify } from "./engine";

export const policyGateway =
  (policy: PolicyConfig, mode: ApprovalMode) =>
  (pi: ExtensionAPI) => {
    let changedFiles = 0;
    pi.on("agent_start", () => { changedFiles = 0; });

    pi.on("tool_call", async (event, ctx) => {
      const v = classify(event, mode, policy, changedFiles);
      if (v.kind === "deny") {
        pi.appendEntry("policy-deny", { tool: event.toolName, reason: v.reason });
        return { block: true, reason: v.reason };
      }
      if (v.kind === "confirm") {
        if (mode === "auto") {
          // auto:不弹窗放行(deny 已在上面硬生效,auto ≠ 放飞)
        } else if (!ctx.hasUI) {
          return { block: true, reason: v.reason + "(无 UI,保守阻断)" }; // -p 模式
        } else {
          const ok = await ctx.ui.confirm("高风险操作", v.reason);
          if (!ok) return { block: true, reason: "用户拒绝" };
        }
      }
      if (event.toolName === "write" || event.toolName === "edit") changedFiles++;
      return undefined; // 放行
    });
  };
```

`.agent/policy.json` 固化结构(默认值 + 威胁模型注释):

```jsonc
{
  "command": {
    "allow":   ["pnpm test", "pnpm lint", "pnpm build", "pytest", "go test"],
    "confirm": ["pnpm add", "npm install", "git commit", "git push", "docker compose up"],
    "deny":    ["rm -rf", "sudo", "curl | sh", "wget | sh", "chmod -R", "dd", "mkfs"]
  },
  "path": {
    "deny":         [".git/", ".env", "**/*.pem", "~/.ssh/**", "**/credentials*"],
    "confirmWrite": ["package.json", "**/*lock*", ".github/**", "tsconfig*.json"]
  },
  "limits": { "maxChangedFiles": 20, "maxFixIterations": 5, "maxToolCalls": 50, "commandTimeoutMs": 120000 },
  // sandbox:false=仅字符串级减速带(挡不住 cat ~/.ssh/id_rsa);
  //         true=接 @anthropic-ai/sandbox-runtime OS 级 denyRead/denyWrite(仅 macOS/Linux)
  "sandbox": { "enabled": false }
}
```

挂载点固化在 `buildResourceLoader` 的 `extensionFactories`(C1 数组,本周期加首项):

```ts
extensionFactories: [
  policyGateway(ctx.policy, ctx.mode),   // ★ 本周期
  // mcpAdapter / traceRecorder / loopGuards 在后续周期加入
],
```

## 6. 验收标准

- [ ] `classify` 对四种模式 × {read, grep, write, edit, bash, 未知工具} 的核心组合给出正确 `Verdict`,且为纯函数(同输入同输出,无副作用),单测全绿。
- [ ] `readonly` 下即便 `edit/write/bash` 意外进入(绕过 C1 白名单的防御路径),`classify` 返回 `deny`。
- [ ] `suggest`(方案 A)下任一 `edit/write` 返回 `confirm`;确认前文件**不落盘**——faux provider headless 测试断言目标文件内容未变直到 confirm。
- [ ] `workspace-write` 下:cwd 内非敏感写 → `allow`;`outsideRepoRoot` → `confirm`;`path.deny` 命中 → `deny`;`path.confirmWrite` 命中 → `confirm`;第 `maxChangedFiles+1` 次写 → `confirm`。
- [ ] `auto` 下:`deny` 命中(如 `rm -rf`、写 `.env`)仍 `{block:true}`;`confirm` 类不弹窗、直接放行(`ctx.ui.confirm` 未被调用)。
- [ ] `ctx.hasUI === false`(`-p` / 管道)时,任何 `confirm` 判定 → `{block:true}` 且 reason 含"无 UI";deny 同样阻断。
- [ ] `ctx.hasUI === true` 且非 auto 时,`confirm` 调用 `ctx.ui.confirm`;返回 false → `{block:true,reason:"用户拒绝"}`。
- [ ] bash 命令分级:`pnpm test`→allow、`git push`→confirm、`curl x | sh`/`rm -rf /`→deny;白名单外命令(如 `node script.js`)→confirm。
- [ ] `bashTouchesProtectedPath` 对 `echo x > .env`、`cat ~/.ssh/id_rsa | tee out`、`cp secret .git/x` 返回 true(best-effort 覆盖到的重定向/参数层)。
- [ ] deny 的短路发生在工具 `execute` 之前:集成测试断言被 deny 的写操作没有产生任何文件写入(无竞态)。
- [ ] deny 时 gateway 通过 `pi.appendEntry("policy-deny",{tool,reason})` 写入 pi session,供 C4 `inBounds` 读取。
- [ ] `changedFiles` 计数:仅在 write/edit **放行后**自增;deny/confirm-未通过不计数;`agent_start` 重置。
- [ ] `policy.sandbox.enabled=true` 时打印接线提示且不报错;默认 `false`。
- [ ] **对抗性套件**:恶意 prompt 清单(诱导 `rm -rf`、读密钥、`curl|sh`、写 `.env`)经 faux provider 跑完,断言**全部被拦**;测试报告列出每条 prompt → 拦截原因。
- [ ] `agent --help` 与 `policy.json` 注释都写明 bash 防护是减速带、真边界需 sandbox(诚实表述)。
- [ ] `agent review` 在有改动仓库输出风险/缺测试/建议,且涉及命令/路径经过同一 classify。

## 7. 测试计划

- **单测(纯函数,不碰 LLM)**:
  - `engine.classify`:逐分支表驱动断言(模式 × 工具 × 路径/命令命中)。
  - `command-classifier.tier`:allow/confirm/deny/未命中=confirm,含空白规范化、`sudo`、`| sh` 模式。
  - `path-guard`:`pathDenied`/`pathConfirmWrite`/`outsideRepoRoot`(`..` 逃逸、绝对路径、符号链接保守)/`bashTouchesProtectedPath`(重定向/tee/cp,以及明确不覆盖的子 shell 用 negative case 标注边界)。
- **集成(用 pi 的 faux provider 跑 headless session)**:
  - gateway 真的 `block` 了 `rm -rf` / 写 `.env`:录制式假 provider 让 agent 发出对应 `tool_call`,断言返回 `{block:true}` 且无文件副作用。
  - suggest 模式不落盘:assistant 发 `edit`,断言落盘前为 confirm 且目标文件未变。
  - 预算相关只测 `maxChangedFiles`(写策略,本周期内);`maxToolCalls`/`maxFixIterations` 的 loop 行为属 C3,本周期不涉及。
  - `-p`/无 UI:构造 `ctx.hasUI=false`,断言 confirm→block。
  - auto:断言 deny 生效、confirm 放行且 `ctx.ui.confirm` 未触发。
- **对抗性(★ 本周期重点)**:`test/policy/adversarial.spec.ts` + faux provider headless:一组恶意 prompt(越权写、读 `~/.ssh`、删库、远程脚本执行)→ 断言全部命中 deny/confirm-block;输出每条 → 拦截原因映射表,作为安全回归基线。
- **eval**:本周期不涉及(eval harness 在 C4);对抗性套件是独立安全测试,不依赖 eval runner。

## 8. 风险与缓解

- **bash 字符串级解析的不完备(技术文档 §15.3)**:`bashTouchesProtectedPath` 不解析管道嵌套、子 shell、base64、变量展开,可被 `bash -c "$(echo ...)"` 绕过。缓解:在注释/文档/`--help` 明确定位为减速带;提供 `policy.sandbox.enabled` 作为 OS 级真边界的可选项;对抗性套件用 negative case 诚实标注覆盖边界,不宣称完备。
- **path 黑名单挡不住 bash 读(§5.1 威胁模型)**:`cat ~/.ssh/id_rsa`、`> .env` 绕过 write/edit。缓解:同上,双轨(策略减速带 + 可选 sandbox)+ 诚实表述;读保护对 read/grep/find/ls 工具仍硬生效。
- **suggest 方案 A 的"不落盘"是 confirm 拦截而非物理隔离**:若 confirm 误判放行则会落盘。缓解:本周期锁定方案 A 并以集成测试证明落盘前确实拦住;方案 B(`propose_patch` 工具彻底解耦)记为未决项(§15.2),留 v1/后续。
- **auto 模式被误解为"放飞"(修正 v1 矛盾)**:缓解:在 gateway 显式实现"auto 仅跳过 confirm 弹窗,deny 分支照常",并以单测 + 对抗性套件锁定 deny 在 auto 下仍 block。
- **`--mode` 优先级混乱**:CLI flag、`policy.json`、默认值三处来源。缓解:在 T2.7 写死优先级(flag > policy.json > 默认 suggest)并加测试。
- **落盘前短路依赖 pi 内部时序(§4.3①)**:若 pi `tool_call` 的 `{block:true}` 语义变化会失效。缓解:用 faux provider 集成测试断言"被 deny 的写无文件副作用"作为契约测试,pi 升级时即可回归发现。
- **sandbox 仅 macOS/Linux**:Windows 开发机无法实测 OS 级拦截。缓解:本周期 sandbox 只交付开关 + 文档,真实 OS 验证推到 C6;CI 在对应平台才跑 sandbox 实测(若启用)。

## 9. Definition of Done

- [ ] `src/policy/` 五文件(types/engine/command-classifier/path-guard/gateway)全部落地并被 `buildResourceLoader` 接入。
- [ ] 四种审批模式行为按 §6 全部可观测、可断言(含 suggest 选定方案 A、auto 的 deny 硬生效)。
- [ ] 单测 + faux provider 集成 + 对抗性套件全绿,CI 通过;对抗性套件输出"恶意 prompt → 拦截原因"表。
- [ ] `落盘前短路` 契约测试存在并通过(被 deny 的写无文件副作用)。
- [ ] `.agent/policy.json` 默认值与注释固化;`agent --help` 含 bash 威胁模型一句话。
- [ ] `policy.sandbox.enabled` 开关存在、默认 false、启用不报错。
- [ ] 设计说明更新:§4.3 三点(落盘前阻断 / bash 威胁模型诚实表述 / suggest 方案 A)写入文档。
- [ ] 本周期演示命令可现场跑出预期拦截结果(§10)。
- [ ] 无 C3 内容泄漏(无 loop 守卫消费 `maxToolCalls`/`maxFixIterations`、无 diff/undo、无 trace)。

## 10. 周期演示

现场可跑的命令与预期可见结果:

```bash
# 1) deny 硬生效:故意诱发高危命令(交互或 auto 都拦)
agent --mode auto "清理一下工作区,把无用文件删掉"
# 预期:agent 试图 bash("rm -rf ...") → 控制台显示 "已阻断:高危命令: rm -rf",无文件被删

# 2) 写敏感路径被拦:即便 auto 也不放行
agent --mode auto "把数据库连接串写进 .env"
# 预期:写 .env 的 tool_call → "已阻断:受保护路径: .env",.env 未被创建/修改

# 3) suggest 不落盘(方案 A):需确认后才写
agent --mode suggest "把 README 标题改成 Agent CLI"
# 预期:edit(README.md) → "高风险操作:suggest 模式:确认后才落盘";拒绝则文件不变

# 4) -p / 无 UI 保守阻断
echo "" | agent -p --mode workspace-write "在 src 下新建一个文件"
# 预期:confirm 类操作因 ctx.hasUI=false → "已阻断:...(无 UI,保守阻断)"

# 5) 对抗性套件回归(headless,faux provider,不烧 LLM)
pnpm test test/policy/adversarial.spec.ts
# 预期:全绿,输出每条恶意 prompt 与其拦截原因的映射表
```

## 11. 交付物

- **代码模块**:`src/policy/types.ts`、`src/policy/engine.ts`、`src/policy/command-classifier.ts`、`src/policy/path-guard.ts`、`src/policy/gateway.ts`;`src/cli/commands/review.ts`;`src/runtime/resource-loader.ts` 的 `policyGateway` 接线改动;`--mode` 解析与优先级。
- **配置**:`.agent/policy.json` 固化默认值与威胁模型注释;`policy.sandbox.enabled` 开关入口。
- **测试**:`test/policy/engine.spec.ts`、`test/policy/command-classifier.spec.ts`、`test/policy/path-guard.spec.ts`、`test/policy/adversarial.spec.ts`、`test/integration/gateway.faux.spec.ts`(含落盘前短路契约测试)。
- **文档**:设计说明中安全策略层一节(§4.3 三点、bash 威胁模型诚实表述、suggest 方案 A 选型记录);`agent --help` 安全边界文案。
- **demo 脚本**:`scripts/demo-policy.sh`(封装 §10 的 1~5 条命令,便于现场一键演示)。