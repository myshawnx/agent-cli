# 测试可靠性与完整性清单

本文档定义 `agent-cli` 的功能测试口径、变更触发流程和发布前验证顺序。目标不是追求“所有真实 agent 行为都自动化”，而是把可确定的本地行为自动化，把真实 provider / 真实外部服务留作明确标注的手动烟测。

## 1. 测试原则

- **默认离线**：`npm test` 只跑 Vitest、本地 fixture、faux provider 和 stub MCP server，不依赖真实 LLM key、GitHub token 或网络。
- **确定性优先**：核心回归用脚本化 faux response、纯函数、临时目录和本地 git repo；真实 provider 结果只做观察，不写入默认 baseline。
- **单一真相源**：功能覆盖以 `docs/当前项目功能流程文档.md` 的实现边界和测试覆盖矩阵为基准；新增能力必须同步更新这里或本文档。
- **按风险选测试**：小改动跑目标测试；跨 extension、CLI、runtime、release 的改动要跑组合测试和打包烟测。
- **清楚标边界**：OS sandbox、真实模型漂移、MCP 远端副作用、跨平台进程树终止等不写成默认自动化已完全验证。

## 2. 测试分层

| 层级 | 目的 | 命令 / 方式 | 通过标准 |
|---|---|---|---|
| L0 静态质量 | 类型、格式、基础构建入口 | `npm run typecheck`、`npm run lint` | 无 TS/biome 报错 |
| L1 单元测试 | 纯逻辑和本地小模块 | `npm test -- <file>` 或 `npm test` | 目标用例稳定通过 |
| L2 离线集成 | pi session + faux provider + stub MCP | `npm test` | 无真实网络、无真实 LLM 调用 |
| L3 打包烟测 | 验证发布产物和 CLI bin 入口 | `npm run build`，`node dist/cli.js --help`，`node dist/cli.js --version` | help/version 正常，构建产物可执行 |
| L4 发布检查 | tarball、demo、baseline 语义 | `npm pack`，`npm run demo:faux`，必要时 `agent eval --provider faux` | 包内容合理，faux demo 可复现 |
| L5 手动真实烟测 | 真实 provider / 外部 MCP / token 依赖 | `agent eval --provider real --scenario <id>` 或真实 MCP demo | 只记录结果，不作为默认 CI 门 |

## 3. 日常变更流程

1. 明确改动归属：CLI、policy、loop、trace、MCP、eval、runtime、docs/release。
2. 先跑最小目标测试，优先选择与改动模块同目录的测试文件。
3. 如果改动跨模块或 extension 顺序，补跑 `test/integration/three-pillars.test.ts`。
4. 如果改动 bash、预算、中断、driver，补跑对应 integration 测试。
5. 如果改动 CLI 入口或 commander 参数，补跑 CLI 参数测试和打包烟测。
6. 如果改动发布脚本、构建、package manifest，补跑 L3/L4。
7. 改动合并前，至少跑 `npm run typecheck` 和相关测试；发布前跑完整流程。

## 4. 变更触发清单

| 改动范围 | 必跑 | 建议补跑 |
|---|---|---|
| `src/policy/**` | `test/policy/*.test.ts` | `test/integration/three-pillars.test.ts`、`agent review` 手动 smoke |
| `src/loop/**` | `test/loop/*.test.ts` | `test/integration/token-budget.test.ts`、`test/integration/three-pillars.test.ts` |
| `src/runtime/bash-timeout*` | `test/runtime/bash-timeout.test.ts` | `test/integration/command-timeout.test.ts` |
| `src/runtime/driver.ts` | `test/integration/print-driver.test.ts` | `test/integration/abort-failsafe.test.ts` |
| `src/runtime/resource-loader.ts` | `test/unit/runtime-seams.test.ts` | `test/integration/three-pillars.test.ts`、`test/integration/prompt-injection.test.ts` |
| `src/runtime/session-factory.ts` | `test/unit/compute-tools.test.ts`、`test/unit/runtime-seams.test.ts` | `test/integration/readonly-session.test.ts` |
| `src/cli/args.ts` | `test/unit/cli-args.test.ts` | L3 打包烟测 |
| `src/cli/commands/init.ts` | `test/integration/init-command.test.ts` | `node dist/cli.js init --cwd <tmp>` 手动 smoke |
| `src/cli/commands/{diff,review,undo,mcp,eval,resume}.ts` | `test/integration/local-cli-commands.test.ts` | 对应 `node dist/cli.js <cmd> --help` smoke |
| `src/cli/commands/history.ts` | `test/integration/history-command.test.ts` | `test/integration/trace-command.test.ts` |
| `src/cli/commands/trace.ts` / `src/trace/**` | `test/trace/projection.test.ts`、`test/integration/trace-command.test.ts` | `test/integration/abort-failsafe.test.ts` |
| `src/mcp/**` | `test/mcp/*.test.ts` | `test/integration/three-pillars.test.ts` |
| `src/eval/**` / `eval/fixtures/**` | `test/eval/scoring.test.ts`、`test/integration/local-cli-commands.test.ts` 中 eval 用例 | `agent eval --provider faux --scenario <id>` |
| `src/context/**` / config schema | `test/config-loader.test.ts`、`test/unit/profile.test.ts` | `test/integration/prompt-injection.test.ts` |
| `src/tools/remember.ts` / memory 写入 | `test/unit/compute-tools.test.ts` | 补或跑 remember 工具执行测试；当前属于覆盖增强项 |
| `scripts/build.mjs` / `package.json` | `npm run build`、`node dist/cli.js --help`、`node dist/cli.js --version` | `npm pack` |
| `scripts/dedupe-pi-ai.mjs` / install 行为 | 手动 inspect 依赖树 | 干净 checkout 上安装验证；不要放进默认离线测试 |
| docs only | 不强制测试 | 如改发布/限制口径，人工核对 README、known-limitations、release checklist 一致 |

## 5. 发布前流程

按顺序执行，前一步失败先修复再继续：

1. `git status --short`：确认没有意外改动。
2. 确认依赖安装时执行过 `postinstall`；如果用了 `--ignore-scripts`，先运行 `node scripts/dedupe-pi-ai.mjs`。
3. `npm run typecheck`
4. `npm run lint`
5. `npm test`
6. `npm run build`
7. `node dist/cli.js --help`
8. `node dist/cli.js --version`
9. `node dist/cli.js eval --provider faux --scenario hono-health-header`
10. `npm run demo:faux`
11. `npm pack` 并检查 tarball 只包含预期发布文件。

`agent eval --provider faux --update-baseline` 只在有意更新 `.agent/eval/baseline.json` 时执行；普通发布验证不应顺手改 baseline。

## 6. 完整性审计清单

每次新增功能或修改核心行为时，按下面问题自检：

- 是否有一条纯逻辑或本地单测覆盖主要分支？
- 是否有一条 faux-provider/headless 集成测试覆盖 pi runtime 接缝？
- 如果功能会写文件，是否覆盖 cwd 内、越界路径、敏感路径和无 UI confirm 行为？
- 如果功能会执行 bash，是否覆盖 allow / confirm / deny 和 timeout 行为？
- 如果功能会改变 extension 顺序，是否验证 policy block 短路语义仍成立？
- 如果功能会写 session entries，是否覆盖 trace/projection 或对应 custom entry？
- 如果功能会修改 `.agent/` 文件，是否覆盖缺失、非法 JSON、schema 不符和正常写入？
- 如果功能会注册动态工具，是否覆盖 readonly 不注册、非 readonly 注册、崩溃/关闭清理？
- 如果功能出现在 README/Quickstart，是否有自动化测试或明确手动 smoke 步骤？
- 如果不能自动化，是否在 `docs/known-limitations.md` 或本文档中标注边界？

## 7. 当前覆盖缺口与补强优先级

这些不是默认发布阻断项，但应作为后续测试补强清单维护：

| 优先级 | 缺口 | 建议补强 |
|---|---|---|
| P0 | 打包后二进制入口自动化不足 | 新增 CLI smoke 测试或 release 脚本覆盖 `dist/cli.js --help/--version` |
| P0 | Commander 子命令分发只抽样覆盖 | 扩展 `test/unit/cli-args.test.ts`，覆盖 `init/review/history/trace/resume/diff/undo/mcp` 参数分发 |
| P1 | `runAsk` / `runResume` follow-up 真实 headless 路径覆盖不足 | 用 faux provider 增加 print-mode continuation 测试 |
| P1 | `remember` 工具执行路径未直接覆盖 | 增加工具执行测试，断言 `.agent/memory.md` 写入和 `memory-write` entry |
| P1 | MCP adapter 工具执行、截断、崩溃摘 active tools 覆盖不完整 | 扩展 adapter headless 测试，复用 stub server |
| P2 | `eval --provider real` 无自动化 | 保持手动 smoke；默认 CI 不跑真实 provider |
| P2 | `scripts/dedupe-pi-ai.mjs` 缺少自动化 | 在干净安装环境做手动验证，或用受控 fixture 做脚本单测 |
| P2 | Windows/macOS 进程树终止未声明为完全验证 | 保持 known limitation，跨平台验证后再提升口径 |

## 8. 故障处理流程

测试失败时按下面顺序收敛：

1. 先确认 Node 版本，必须满足 `package.json` 的 `engines.node >=22.19.0`。
2. 如果 faux-provider headless 测试报 `No API provider registered for api: faux`，检查 `postinstall` 是否执行过，以及是否存在嵌套 `@earendil-works/pi-ai`。
3. 如果 git 相关集成测试失败，确认测试使用的是临时 repo，且本机 `git` 可用。
4. 如果 MCP stdio 测试挂起，优先看 stub server 模式、request timeout 和子进程清理。
5. 如果 command timeout 测试不稳定，记录平台和 shell，按 known limitation 判断是否是进程树终止差异。
6. 如果只有真实 provider smoke 失败，不直接判定发布失败；记录模型、日期、prompt、场景和凭证状态。

## 9. 通过口径

日常开发通过口径：

- 目标测试通过。
- 相关文档口径没有被改坏。
- 没有新增真实网络或真实 provider 依赖进入默认 `npm test`。

发布通过口径：

- L0-L4 全部通过。
- 已知 L5 手动项要么通过，要么有明确“不阻断发布”的记录。
- `docs/known-limitations.md`、`README.md`、`docs/RELEASE.md` 与当前实现边界一致。
