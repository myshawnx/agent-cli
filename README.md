# Agent CLI

> A local-first CLI coding assistant **built on the open-source [pi](https://pi.dev) agent harness (MIT)** — used as a library via its public SDK, never forked.
>
> pi provides the agent loop, tools, session tree, and compaction. Agent CLI adds what a team needs to **actually ship** an agent: a **declarative safety/approval policy layer**, **MCP tool integration**, an **eval/benchmark harness**, and **cross-session project memory**.

---

## pi gives me… / I add…

| Capability | pi (used as library) | Agent CLI (net-new) |
|---|---|---|
| Agent loop, tool calling, state | ✅ native | reused as-is |
| Read/write/edit/bash tools | ✅ native | reused; **hardened with a policy gateway** |
| Session persistence / resume / fork | ✅ native (tree JSONL) | reused; TaskView projected from it |
| `-p` print mode / SDK / RPC | ✅ native | thinly wrapped in our CLI |
| **Declarative approval-mode state machine + command risk tiering** | ❌ | ★ net-new (C2) |
| **MCP tool integration** (stdio JSON-RPC) | ❌ | ★ net-new (C5) |
| **Eval / benchmark harness** (deterministic, offline, model×scenario matrix) | ❌ | ★★ net-new — highest hiring signal (C4) |
| **Project profile + cross-session memory** | ❌ | ★ net-new (small but real) |

## Quickstart

```bash
npm install           # runs postinstall dedupe needed by faux-provider tests
npm run build          # esbuild -> dist/cli.js (TS fallback when native spawn is blocked)
npm test               # vitest (offline, faux provider, zero LLM calls)

# Commands (C2 — v0.2 policy gateway)
agent --version
agent --help
agent init             # detect profile and scaffold .agent/
agent -p "这个项目是做什么的?"     # read-only print-mode Q&A (default: suggest)
agent --mode auto -p "写一个工具函数"  # auto-approve safe writes, deny is still hard
agent review           # review git diff for policy risks and missing tests
agent history          # list pi sessions for this cwd (C3)
agent diff             # show staged/unstaged file diff (C3)
agent undo             # stash file changes only; command side effects remain (C3)
agent eval --provider faux   # deterministic offline eval matrix (C4)
agent eval --provider real --scenario hono-health-header --model claude-sonnet-4-6
agent mcp list               # list .agent/mcp.json stdio servers (C5)
npm run demo:faux            # offline hero demo (C6)
```

v0.2 adds a **declarative approval-mode policy gateway**: `readonly` | `suggest` | `workspace-write` | `auto`. All tool calls flow through `classify(bash, path, mode, policy)` before execution. An adversarial test suite (94 tests, offline) proves the speed bump catches `rm -rf`, `curl | sh`, writes to `.env`, and reads outside the repo root.

v0.3 adds **loop guards + task trace + diff/undo**. The extension order is fixed as policy → loopGuards → traceRecorder → later adapters, so policy denies short-circuit before budget counting. Loop guards enforce `maxToolCalls`, block reward-hacking writes to test files during fix-test tasks, soft-stop repeated identical test failures, and preserve the working diff for handoff. Trace entries (`task-meta`, `task-tool-call`, `task-result`) are persisted in pi sessions; `agent history`, `agent resume`, `agent diff`, and `agent undo` build on that single source of truth. `agent undo` uses `git stash --include-untracked` and only reverts files, not command side effects.

v1.0 completes **C4–C6**: `agent eval --provider faux` runs deterministic fixture scoring with baseline diff support, `agent eval --provider real --scenario ...` can run a live provider smoke scenario when credentials are configured, `agent mcp add/list/remove` manages stdio MCP servers and registers `mcp__server__tool` dynamic tools, bash calls are hard-capped by `commandTimeoutMs`, token budgets soft-stop via session usage, and `npm run demo:faux` provides an offline release demo. The packaged CLI reports version `1.0.0`.

## Architecture

```
Agent CLI (independent binary — `import` pi from npm)
├── SDK layer        → createAgentSession / SessionManager / SettingsManager
├── Extension layer  → policyGateway / loopGuards / traceRecorder / commandTimeoutBash / rememberTool / mcpAdapter
│                       (in-process extension factories, same model as pi extensions)
└── Policy + measure  → declarative engine / MCP adapter / eval harness / memory
```

## Threat model (honest)

- The **policy engine is a speed bump** (string-level bash classification, glob-based path deny).
  It is NOT an OS security boundary — `cat ~/.ssh/id_rsa` bypasses it.
- `policy.sandbox.enabled` is a reserved field in v1.0. It warns when configured but does not wire an OS sandbox yet.
- An adversarial test suite proves what the speed bump catches; OS-level sandboxing remains a documented follow-up.

See [`docs/known-limitations.md`](docs/known-limitations.md) for the release boundaries.

## Development cycles

See [`docs/`](docs/) for the full plan:

| Cycle | Theme | Net-new |
|---|---|---|
| C0 | Foundation + faux test harness | ★ headless deterministic infra |
| C1 | SDK shell + readonly understanding | profile / memory injection |
| C2 | Safety policy layer | ★ approval-mode FSM + adversarial tests |
| C3 | Loop guards + task trace + diff/undo | ★ budget / anti-reward-hacking |
| C4 | Eval / benchmark harness | ★★ measurement (highest signal) |
| C5 | MCP adapter + GitHub demo | ★ external tool integration |
| C6 | Harden, demo, release | integration tests + hero demo |

## License

MIT — see [LICENSE](LICENSE).

This project is built on the [pi](https://pi.dev) agent harness created by Mario Zechner ([earendil-works](https://github.com/earendil-works)), also MIT-licensed.
