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
npm install --ignore-scripts
npm run build          # esbuild -> dist/cli.js
npm test               # vitest (offline, faux provider, zero LLM calls)

# Commands (C0 — placeholder; real behaviour lands C1→)
agent --version
agent --help
```

## Architecture

```
Agent CLI (independent binary — `import` pi from npm)
├── SDK layer        → createAgentSession / SessionManager / SettingsManager
├── Extension layer  → policyGateway / mcpAdapter / traceRecorder / loopGuards
│                       (in-process extension factories, same model as pi extensions)
└── Policy + measure  → declarative engine / MCP adapter / eval harness / memory
```

## Threat model (honest)

- The **policy engine is a speed bump** (string-level bash classification, glob-based path deny).
  It is NOT an OS security boundary — `cat ~/.ssh/id_rsa` bypasses it.
- For a **true boundary**, enable the optional sandbox (`@anthropic-ai/sandbox-runtime`, macOS/Linux only).
- Both levels are documented honestly; an adversarial test suite proves what the speed bump catches.

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
