# Known Limitations

This document is the v1.0 release boundary. It separates implemented guardrails from fields or ideas that remain intentionally reserved.

## Implemented With Caveats

- `limits.tokenBudget` is consumed by `loopGuards`: assistant usage is accumulated from `message_end`, `token-usage` entries are written, and budget exhaustion sends a soft-stop plus blocks later tool calls. It is not a hard pre-request cap; the in-flight provider response can exceed the budget before the next guard point.
- `limits.commandTimeoutMs` is enforced for bash through `commandTimeoutBash()`. The config is milliseconds; pi bash input remains seconds. On timeout, an `AbortController` aborts the wrapped local bash operation and delegates process cleanup to pi/bash best effort.
- Patch locate failures from `edit`/`apply_patch` are recorded as `patch-locate-failed`. Print/no-UI runs soft-stop; interactive runs ask for confirmation before steering the agent to reread and retry.
- Ctrl-C/SIGTERM and prompt exceptions in print mode write `abort-preserved` and failed `task-result` entries. The working diff is preserved; no rollback is attempted.
- `agent resume` supports both print and interactive paths. Print mode still needs an explicit follow-up prompt; interactive mode can reopen the session TUI with or without an initial prompt.
- `agent eval --provider real --scenario <id>` now drives a real headless session for a smoke scenario. It needs configured credentials, may spend tokens, and can fail due to model drift.

## Still Limitations

- Policy checks are string/glob based and not a security boundary.
- Bash parsing is best-effort; nested shells, encoded payloads, aliases, and environment indirection can bypass classification.
- `policy.sandbox.enabled` is a reserved v1.0 field. The CLI warns when it is enabled, but `@anthropic-ai/sandbox-runtime` is not wired.
- `suggest` mode uses confirmation before `edit`/`write` executes. A separate `propose_patch` tool is deferred.
- MCP tool side effects are integration boundaries, not policy boundaries. Secondary file writes or bash calls still pass through policy, but a remote MCP tool's own network-side effects are outside local classification.
- MCP is intentionally not registered in `readonly` mode. This preserves the hard read-only tool boundary; future read-only MCP would need MCP tool-level policy instead of enabling the adapter directly.
- MCP streaming results are not forwarded incrementally; results are returned once and truncated via pi `truncateTail(...).content`.
- `agent undo` reverts files only via git stash and does not undo command side effects.
- Cross-process coordination is not implemented. v1.0 assumes one active agent process per repo for `.agent/` writes and git operations.
- Windows process-tree termination is best-effort when a shell command ignores termination. macOS/Linux and Windows should be verified separately before claiming platform parity.
- Faux-provider headless integration depends on `postinstall` running `scripts/dedupe-pi-ai.mjs`. If lifecycle scripts are disabled, `pi-coding-agent` may keep a nested physical `@earendil-works/pi-ai`; `registerFauxProvider()` can then register against the top-level registry while the agent loop reads the nested registry, causing `No API provider registered for api: faux:...`.
- The pi-backed integration tests (faux-provider headless sessions) require Node >= 22.19, matching `package.json` `engines`. The bundled `undici` in `@earendil-works/pi-coding-agent` calls `webidl.util.markAsUncloneable`, which only exists on Node >= 20.19/22; on older runtimes those test files throw at import. The pure-logic suites (policy engine, gateway deny recording, loop guards, path guard, profile, bash timeout, trace projection) have no such dependency and run on any supported Node.
