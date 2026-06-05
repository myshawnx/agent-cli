# Agent CLI Architecture

Agent CLI is an independent binary that imports the open-source pi harness as an SDK. It does not fork pi.

```text
Agent CLI
├── SDK shell        createAgentSession / SessionManager / SettingsManager
├── Extension chain  policyGateway → loopGuards → traceRecorder → remember → mcpAdapter
└── Measurement      eval harness / scoring / baseline report
```

## Extension Order

1. `policyGateway` classifies built-in and unknown tools first. Deny blocks are persisted as `policy-deny` custom entries.
2. `loopGuards` counts only calls that survive policy, enforces `maxToolCalls`, and blocks reward-hacking edits to tests.
3. `traceRecorder` writes `task-meta`, `task-tool-call`, `task-modified-file`, and `task-result` to the pi session.
4. `rememberTool` appends durable notes to `.agent/memory.md` and writes `memory-write` entries.
5. `mcpAdapter` registers configured stdio MCP tools as `mcp__server__tool` dynamic tools.

## Single Source Of Truth

The pi session tree remains the durable truth. Agent CLI projects read-only task views from custom session entries instead of maintaining a parallel task database.

