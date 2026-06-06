# Agent CLI Architecture

Agent CLI is an independent binary that imports the open-source pi harness as an SDK. It does not fork pi.

```text
Agent CLI
├── SDK shell        createAgentSession / SessionManager / SettingsManager / InteractiveMode
├── Extension chain  policyGateway → loopGuards → traceRecorder → commandTimeoutBash → remember → mcpAdapter
├── Safety & limits  policy engine / token budget soft-stop / bash timeout / failure handoff
└── Measurement      faux eval / real-provider smoke / scoring / baseline report
```

## Extension Order

1. `policyGateway` classifies built-in and unknown tools first. Deny blocks are persisted as `policy-deny` custom entries.
2. `loopGuards` counts only calls that survive policy, enforces `maxToolCalls`, tracks `tokenBudget`, blocks reward-hacking edits to tests, and records patch locate failures.
3. `traceRecorder` writes `task-meta`, `task-tool-call`, `task-modified-file`, and `task-result` to the pi session.
4. `commandTimeoutBash` wraps pi's bash tool so `commandTimeoutMs` aborts command execution instead of only annotating input.
5. `rememberTool` appends durable notes to `.agent/memory.md` and writes `memory-write` entries.
6. `mcpAdapter` registers configured stdio MCP tools as `mcp__server__tool` dynamic tools and truncates large results via pi `truncateTail(...).content`.

## Single Source Of Truth

The pi session tree remains the durable truth. Agent CLI projects read-only task views from custom session entries instead of maintaining a parallel task database.
