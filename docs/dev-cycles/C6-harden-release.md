# Cycle C6:v1.0 — 硬化、演示与发布(预计 9 天 · 周期 7/7)

## 1. 周期目标

本周期把 C2/C4/C5 三支柱(安全策略层 / eval harness / MCP adapter)在同一进程、同一条命令里联调跑通,并把技术文档 §11 错误处理表里早期仍待收口的四项(测试命令超时、patch fuzzy 失败处置、abort 时序、token 预算软停)收成有测试覆盖或明确边界的行为;同时产出对外资产——hero demo 脚本、README + 架构图 + "pi 给了什么/我加了什么"设计说明、面试问答手册、esbuild 打包与发布物。放在最后是因为:联调要求前六周期的扩展工厂(`policyGateway` / `mcpAdapter` / `traceRecorder` / `loopGuards`)全部存在且各自单元/集成测试已绿,本周期只做组合验证与收口,不引入新的核心能力。

## 2. 范围

### 2.1 In-scope(本周期做)

- **三支柱联调**:在一条真实命令路径里同时挂载 `policyGateway`(C2)、`loopGuards`(C3)、`traceRecorder`(C3)、`mcpAdapter`(C5),并跑 `agent eval`(C4)验证组合行为不互相破坏(尤其多个 `tool_call` hook 的短路顺序:任一返回 `{block:true}` 即停)。
- **错误处理收尾(技术文档 §11 后四行 + §15 第 1、3 条)**:
  - 测试命令挂死 → bash 执行包一层超时 → 回灌 timeout 错误(不是无限等待);子进程树终止按平台 best-effort 表述。
  - patch fuzzy 匹配失败 → 不静默写错位置,转 `confirm`(交互)或停(`-p`),并产出可读报告。
  - Ctrl-C / SIGTERM → print driver 记录失败保全(保留 diff + 失败摘要,不回滚到空)并 dispose session。
  - token 预算验证:`loopGuards` 从 `message_end` 的 assistant usage 累计 token,超额后主动 `sendMessage` soft-stop,并在下一次 `tool_call` 前阻断;文档明确这是软停,不是 provider 请求前硬上限。
- **hero demo 脚本**:当前 `scripts/demo/hero.sh` 是 6 步脚本:build、当前 diff policy review、安全拦截证明、eval 回归表、MCP config smoke、undo 边界说明。`--faux` 模式无真 key;安全拦截用对抗性 policy 测试证明,不是模型真实发出危险 bash。真 provider 模式才尝试模型驱动的安全拦截。
- **README + 架构图 + 设计说明**:三层架构图(SDK 外壳 / in-process 扩展 / 策略+度量层),逐模块 "pi 给了什么 / 我加了什么" 对照(落地需求文档 §3 那张表)。
- **面试问答手册**:预设问答(需求文档 §14)+ 红队应答(对抗性 prompt 被拦的现场证据指针)。
- **打包 / 发布**:esbuild 把 `src/main.ts` 打成单文件 CLI 产物,配 `bin`,产出可 `npm pack` / 可执行的发布物,固化版本号 v1.0.0。
- **技术文档 §15 五个未决问题逐条收口**:每条给"已落地结论"或"明确 known-limitation"。

### 2.2 Out-of-scope(明确推迟)

- suggest 模式 B 方案(`propose_patch` 工具,§15 第 2 条):v1.0 保持 C2 已采用的 A 方案(gateway 判 `confirm`,确认前不落盘);B 留作 v1.1,本周期文档明确标 known-limitation。
- MCP 流式结果 `onUpdate` 透传(§15 第 4 条):v1.0 按一次性结果处理,推迟至 v1.1。
- 跨进程并发锁 / 租约(§15 第 5 条):v1.0 只保证单进程 per-cwd,文档标 known-limitation,推迟至 v1.1。
- bash 路径解析追求完备(子 shell / base64 还原,§15 第 3 条):维持 best-effort 减速带定位,真边界交 sandbox,本周期不扩展解析深度。
- 新增 eval 场景 / 新 MCP server 适配:fixture 与 server 集合在 C4/C5 冻结,本周期不扩。

## 3. 前置依赖

- **C0**:测试地基(faux provider 封装、tsconfig、CI 脚本)、仓库骨架 `src/` 目录结构。
- **C1**:`runtime/session-factory.ts`(`buildSession` / `computeTools`)、`runtime/driver.ts`(interactive / print 两种驱动)、`runtime/resource-loader.ts`、`agent init`、`context/profile.ts`。
- **C2**:`policy/`(`engine.ts` 的 `classify`、`gateway.ts` 的 `policyGateway`、`command-classifier.ts`、`path-guard.ts`)+ 对抗性测试套件已绿。
- **C3**:`loop/guards.ts`(`loopGuards`:预算 / 反作弊 / 无进展检测 / 失败保全)、`trace/`(`entries.ts` 的 `traceRecorder`、`projection.ts`)、`agent diff` / `agent undo`(git-checkpoint)。
- **C4**:`eval/`(`harness.ts`、`scoring.ts`、`report.ts`、`fixtures/scenarios.json`、planted-bug repos)、`.agent/eval/baseline.json`。
- **C5**:`mcp/`(`stdio-client.ts`、`schema-map.ts`、`adapter.ts`、`config.ts`)+ MCP 配置命令与动态工具注册路径。GitHub 真演示依赖外部 server/token,不作为当前固定验收承诺。
- **外部条件**:真 provider 跑 hero demo 需要 `anthropic` API key(faux provider 路径不需要);MCP GitHub 真演示需要 `GITHUB_TOKEN` 与可用的 GitHub MCP server 二进制。当前验证口径主要是 Linux/WSL + Node 22;Windows/macOS 进程树终止不写成已完全验证的平台承诺。

## 4. 工作分解 WBS

| 任务 | 涉及文件/模块 | 说明 | 估时 |
|---|---|---|---|
| T6.1 | `runtime/resource-loader.ts`、`test/integration/three-pillars.test.ts` | 已完成:同一 faux headless session 中挂 `policyGateway`+`loopGuards`+`traceRecorder`+`mcpAdapter`,并断言 policy deny、loop guard、trace entry、MCP 动态工具注册均可观测。 | 0.5d |
| T6.2 | `policy/gateway.ts`、`loop/guards.ts` | 验证并固化多 `tool_call` hook 的短路语义:任一工厂返回 `{block:true}` 即终止后续 hook 与 `execute`;补一条测试断言 `loopGuards` 的预算 block 与 `policyGateway` 的 deny 不会互相吞掉 reason。 | 0.5d |
| T6.3 | `runtime/bash-timeout.ts`、`runtime/bash-timeout-core.ts`、`test/integration/command-timeout.test.ts` | 已完成:真实 bash 长跑命令受 `commandTimeoutMs` 中止并回灌 timeout 错误。进程树终止跨平台仍按 known limitation 表述。 | 1d |
| T6.4 | `loop/guards.ts`、`test/loop/guards.test.ts` | 已有单测覆盖:patch locate 失败记录 `patch-locate-failed`;无 UI soft-stop;有 UI 时确认重读重试或拒绝后 soft-stop。端到端覆盖可后续补。 | 1d |
| T6.5 | `runtime/driver.ts`、`test/integration/abort-failsafe.test.ts` | 已完成:SIGTERM 中途触发时保留 diff/modified files,写 `abort-preserved` 与 failed `task-result`,并 dispose session。 | 1d |
| T6.6 | `loop/guards.ts`、`test/integration/token-budget.test.ts` | 已完成:用 faux provider 注入 usage,断言越过 `tokenBudget` 后 soft-stop,并在下一次 `tool_call` 前阻断;known limitation 写明软停窗口。 | 1d |
| T6.7 | `scripts/demo/hero.sh`、`eval/fixtures/hono-api` | 已完成脚本骨架:build → review → safety proof → eval → MCP list smoke → undo boundary。它不承诺无 key 下完成真实 bugfix 或外部 PR 汇总;真实模型路径依赖 provider key。 | 1.5d |
| T6.8 | `README.md`、`docs/architecture.md`、`docs/pi-vs-ours.md`、架构图源文件 | README + 三层架构图 + "pi 给了什么/我加了什么"逐模块对照(落地需求文档 §3 表),含安装、用法、威胁模型诚实表述。 | 1d |
| T6.9 | `docs/interview-qa.md` | 面试问答手册:预设问答(需求文档 §14 六问)+ 红队应答(每条配指向对抗性测试用例的证据指针)。 | 0.5d |
| T6.10 | `package.json`、`scripts/build.mjs` | 已完成 build 脚本:`src/main.ts` → `dist/cli.js`,Node 22 target,pi 依赖 external,esbuild 失败时回退 TypeScript transpile。 | 1d |
| T6.11 | `docs/known-limitations.md`、`README.md` | 技术文档 §15 五条逐条给结论 / known-limitation,并在 README 链接。 | 0.5d |
| T6.12 | CI 配置、`docs/RELEASE.md` | 发布前最终回归:全单测 + 集成 + 对抗性 + faux eval 一键跑绿;写发布清单与 tag 步骤。 | 0.5d |

## 5. 关键接口 / 数据结构

本周期不新增核心模块,主要固化"收尾"相关的类型与脚本契约。

bash 超时配置(并入 C2 的 `PolicyConfig.limits`,新增一个字段):

```ts
// policy/types.ts —— 在已有 Limits 上补 commandTimeoutMs
export interface Limits {
  maxChangedFiles: number;
  maxFixIterations: number;
  maxToolCalls: number;
  tokenBudget?: number;
  commandTimeoutMs?: number;   // ★ C6 新增:bash 命令硬超时,默认 120_000
}
```

bash 超时执行包装(T6.3),复用 pi 的 abort signal 透传,不另造执行器:

```ts
// runtime/bash-timeout.ts
// 在 loopGuards / gateway 之外,作为对 bash execute 的超时守卫:
// 到点 controller.abort() → pi 的 bash 工具接 signal 终止子进程 → 回灌失败
export function withCommandTimeout(
  signal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean } {
  const controller = new AbortController();
  let fired = false;
  const onParentAbort = () => controller.abort();
  signal.addEventListener("abort", onParentAbort);
  const timer = setTimeout(() => { fired = true; controller.abort(); }, timeoutMs);
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", onParentAbort);
  });
  return { signal: controller.signal, timedOut: () => fired };
}
```

patch fuzzy 失败的处置结果(T6.4),写进 trace 的自定义 entry,复用 `pi.appendEntry`:

```ts
// trace/entries.ts —— 复用 C3 的 traceRecorder,补一类 entry
pi.appendEntry("patch-locate-failed", {
  tool: "edit",
  path,
  reason: "fuzzy 匹配失败,无法唯一定位目标片段",
  action: hasUI ? "confirmed-with-user" : "halted",
});
```

hero demo 脚本契约(T6.7),对脚本调用方的可见行为:

```bash
# scripts/demo/hero.sh [--faux]
#   step 1 build:     npm run build
#   step 2 review:    node dist/cli.js review --mode workspace-write
#   step 3 safety:    --faux 时运行 test/policy/adversarial.test.ts;真 provider 时诱发危险 bash 并由 policy deny
#   step 4 eval:      node dist/cli.js eval --provider faux|real
#   step 5 mcp:       node dist/cli.js mcp list
#   step 6 undo:      打印 file-only undo 边界,不在 dirty demo checkout 上实际运行 undo
# --faux 时不需要真 provider key;否则需要已配置 provider key,并可能消耗 token。
```

esbuild 打包入口(T6.10):

```ts
// scripts/build.mjs
import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/cli.js",
  platform: "node",
  format: "esm",
  bundle: true,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui"],
});
```

```jsonc
// package.json(固化)
{
  "version": "1.0.0",
  "engines": { "node": ">=22.19.0" },
  "bin": { "agent": "dist/cli.js" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "postinstall": "node scripts/dedupe-pi-ai.mjs",
    "demo": "bash scripts/demo/hero.sh",
    "demo:faux": "bash scripts/demo/hero.sh --faux",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "test": "vitest --run"
  }
}
```

## 6. 验收标准

- [x] 三支柱联调集成测试(T6.1)已由 `test/integration/three-pillars.test.ts` 覆盖:同一 session 同时挂 policy/loop/trace/MCP,并观测到各自 entry 或 active tool。
- [x] 多 `tool_call` hook 短路顺序(T6.2)已由 `test/integration/three-pillars.test.ts` 覆盖:当前代码固定 policy 在前,并断言 policy block 后后续 `tool_call` hook 不执行。
- [x] 测试命令超时(T6.3)已由 `test/integration/command-timeout.test.ts` 覆盖:长跑 bash 在 `commandTimeoutMs` 后返回 timeout 错误。子进程树跨平台清理仍按 known limitation 表述。
- [x] patch fuzzy 失败(T6.4)已由 `test/loop/guards.test.ts` 覆盖:无 UI soft-stop、有 UI confirm/retry 或 decline;端到端测试可后续补。
- [x] abort 时序(T6.5)已由 `test/integration/abort-failsafe.test.ts` 覆盖:SIGTERM 时保留 modified files、写 `abort-preserved` 和 failed `task-result`、dispose session。
- [x] token 预算(T6.6)已由 `test/integration/token-budget.test.ts` 覆盖:超额 usage 后 soft-stop,下一次 `tool_call` 前 block;known-limitation 写明它不是硬上限。
- [x] hero demo(T6.7)脚本存在并反映真实 fidelity:build/review/safety proof/eval/MCP list/undo boundary。它不承诺无 key 下完成 bugfix diff 或外部 PR 汇总。
- [x] README + 架构图 + 设计说明(T6.8)已有对应文档资产;威胁模型需保持“策略=减速带,sandbox 未接 OS 边界”的诚实表述。
- [x] 面试问答手册(T6.9)已有 `docs/interview-qa.md`。
- [x] 打包(T6.10):`npm run build` 使用 `scripts/build.mjs` 产出 `dist/cli.js`,版本为 1.0.0;`npm pack` 冒烟需发布前手动跑。
- [x] §15 五条收口(T6.11)已落到 `docs/known-limitations.md`。
- [ ] 发布前回归(T6.12):全单测 + 集成 + 对抗性 + faux eval 一键跑绿仍以实际发布前 CI/本地结果为准。

## 7. 测试计划

- **单测**:`runtime/bash-timeout.test.ts` 覆盖 timeout core;`test/loop/guards.test.ts` 覆盖 token budget、patch locate、no-progress、reward-hacking;`test/mcp/schema-map.test.ts` 与 `test/mcp/stdio-client.test.ts` 覆盖 MCP schema 与持久连接生命周期。纯逻辑或本地 stub,不碰真实 LLM。
- **集成(pi faux provider 跑 headless session)**:用 pi 的 `registerFauxProvider` / `setResponses`(`packages/coding-agent/test/suite/harness.ts` 模式)注入确定性回放——
  - 三支柱联调端到端(T6.1)。
  - 命令超时返回 timeout 错误(T6.3)。
  - token 预算越限 soft-stop 并在下一次工具调用前阻断(T6.6)。
- **失败保全**:`test/integration/abort-failsafe.test.ts` 用 mock session 触发 SIGTERM,覆盖保留 diff/failed result/dispose 路径(T6.5)。
- **对抗性**:复用 C2 的恶意 prompt 套件,在三支柱联调环境下重跑,断言 `rm -rf` / `curl|sh` / 写 `.env` / 读 `~/.ssh` 全部被 deny,并把这些用例作为面试手册红队应答的证据指针(T6.9)。
- **eval**:`npm run demo:faux` 内嵌 `agent eval --provider faux`,既验证 demo 脚本也验证 C4 回归表能在确定性下产出(T6.7);真 provider 的 `agent eval` 留给发布前手动一次。
- **打包冒烟**:`npm pack` + `node dist/cli.js --help` + `node dist/cli.js -p "echo"`(T6.10)。

## 8. 风险与缓解

- **多扩展 `tool_call` hook 顺序未定义导致 deny 被吞**:pi 按注册顺序串行调用 hook,任一 block 即短路;风险在我们注册顺序错把 `loopGuards` 放在 `policyGateway` 前导致预算 reason 盖过安全 reason。缓解:当前 `resource-loader` 固定注册顺序为 policy → loopGuards → trace → bash timeout → remember → MCP(非 readonly) → extra。
- **杀进程在 Windows 与 POSIX 行为不一致(§11 测试命令挂死)**:`AbortController` 终止子进程树在两平台语义不同。当前验证主要是 Linux/WSL + Node 22;Windows/macOS 不写成已完全验证,在 `docs/known-limitations.md` 标为 best-effort。
- **token 预算只能软停、非硬中断(§15 第 1 条)**:usage 计数 + `sendMessage` 停止存在"当前 turn 已发出请求"的时序窗口。缓解:T6.6 验证它在下一次 `tool_call` 前生效,并在 `docs/known-limitations.md` 诚实写明窗口,不号称硬上限。
- **真 provider hero demo 不可复现(网络/额度/模型漂移)**:面试现场断网或额度耗尽则演示崩。缓解:`--faux` 路径完全确定性、零外部依赖,作为主用演示;真 provider 作为加分项,二者都进 README。
- **bash 路径解析 best-effort 被质疑为"假安全"(§5.1 威胁模型)**:缓解:README 与 `--help` 都明示策略=减速带、sandbox=真边界,面试手册红队应答直接承认绕过点并指向 sandbox 兜底。
- **MCP GitHub demo 依赖外部 server 二进制 / token**:当前 hero 脚本只做 `mcp list` 配置 smoke,不承诺外部 PR 汇总。完整外部 server 演示应作为手动加分项,并在运行前检查依赖。

## 9. Definition of Done

- 代码:T6.1、T6.3、T6.4、T6.5、T6.6、T6.10 的关键代码已落地;注册顺序固定;`commandTimeoutMs` 在 policy schema/default 中可用。
- 测试:新增单测 + faux/headless 集成覆盖主要硬化项;两平台杀进程测试不要写成已完成。
- 文档:README + 架构图 + `docs/pi-vs-ours.md` + `docs/interview-qa.md` + `docs/known-limitations.md` + `docs/RELEASE.md` 已有文档资产,需持续保持当前实现口径。
- 演示:`npm run demo:faux` 展示当前 6 步脚本 fidelity;不承诺无 key/无网络完成真实 bugfix 或外部 PR 汇总。
- 发布:`npm run build` 产物可执行;`npm pack`、tag、真 provider smoke 仍是发布前操作。

## 10. 周期演示

```bash
# 一、确定性主演示(无需 key / 网络,面试主用)
npm run demo:faux
#   预期依次可见:
#   step1 build: 产出 dist/cli.js
#   step2 review: 当前 diff 的 policy review
#   step3 safety: faux 模式运行 adversarial policy 测试证明 deny 行为
#   step4 eval: faux 回归表
#   step5 mcp: mcp list 配置 smoke
#   step6 undo: 打印 file-only undo 边界

# 二、单点收尾验证
agent -p "运行 sleep 9999"          # 预期:到 commandTimeoutMs 后回灌 timeout 错误
agent eval --provider faux          # 预期:确定性回归表,exit code 反映通过率

# 三、打包产物验证
npm run build && node dist/cli.js --help   # 预期:列出 run/ask/review/diff/undo/mcp/eval/init 子命令,版本 1.0.0

# 四、真 provider 加分演示(配齐 ANTHROPIC/GITHUB token 时)
npm run demo
```

## 11. 交付物

- 代码:`runtime/bash-timeout.ts`、`runtime/bash-timeout-core.ts`、`config/schema.ts`/`policy/types.ts`(`commandTimeoutMs`)、`runtime/driver.ts`、`loop/guards.ts`、`policy/gateway.ts`、`trace/entries.ts` 的收尾改动、`scripts/build.mjs`、`scripts/dedupe-pi-ai.mjs`、`package.json`(bin / version / engines / scripts)。
- 测试:`test/integration/three-pillars.test.ts`、`test/integration/command-timeout.test.ts`、`test/integration/abort-failsafe.test.ts`、`test/integration/token-budget.test.ts`、对抗性套件在联调环境的重跑配置。
- 文档:`README.md`、`docs/architecture.md`(三层架构图)、`docs/pi-vs-ours.md`("pi 给了什么/我加了什么")、`docs/interview-qa.md`(预设问答 + 红队应答)、`docs/known-limitations.md`(§15 五条结论)、`docs/RELEASE.md`。
- demo:`scripts/demo/hero.sh`(`--faux` 与真 provider 双模式)。
- 发布物:`dist/cli.js`(esbuild 单文件 + `bin: agent`)、`npm pack` tarball、v1.0.0 tag。
