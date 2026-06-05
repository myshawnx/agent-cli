# pi vs Agent CLI

| Capability | pi Harness | Agent CLI |
|---|---|---|
| Agent loop, tools, session tree | Provides | Reuses via SDK |
| Read/write/bash/edit tools | Provides | Reuses behind policy gateway |
| Session resume/fork | Provides | Exposes `history` / `resume` wrappers |
| Declarative approval modes | Not the focus | Adds `readonly` / `suggest` / `workspace-write` / `auto` policy FSM |
| Loop guards | Not the focus | Adds budget, reward-hacking guard, no-progress soft stop |
| Task trace | Custom extension surface | Adds task projection from pi custom entries |
| Eval harness | Not the focus | Adds deterministic scenario scoring and baseline diff |
| MCP stdio | Not the focus | Adds `.agent/mcp.json` and dynamic MCP tools |
| Project memory | Prompt/session hooks | Adds `.agent/memory.md` read/write path |

