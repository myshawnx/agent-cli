# Known Limitations

- Policy checks are string/glob based and not a security boundary.
- Bash parsing is best-effort; nested shells, encoded payloads, and environment indirection can bypass classification.
- Token budgets are soft stops; one in-flight model response can exceed a configured budget before the next guard point.
- `agent undo` reverts files only via git stash and does not undo command side effects.
- The deterministic eval harness uses faux patches by default; real-provider evals are reserved for manual release checks.
- Windows process-tree termination is best-effort when a shell command ignores termination.

