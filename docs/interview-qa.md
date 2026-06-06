# Interview QA

## Why build on pi instead of forking it?

The project goal is product-level agent engineering, not reimplementing a harness. pi supplies the loop, tools, session tree, compaction, and TUI. Agent CLI adds the layers a team needs around that runtime: policy, loop guards, evals, memory, MCP, and release ergonomics.

## Why not just write a few pi extensions?

The CLI needs its own process entrypoint: subcommands, print-mode policy behavior, eval orchestration, profile init, history/diff/undo wrappers, and release scripts. Extensions are still the right runtime seam, but the product surface is an SDK shell around pi.

## Is the policy layer a sandbox?

No. It is a declarative speed bump that classifies tool calls before execution. It catches common risky strings and sensitive paths, but it is not an OS boundary. `policy.sandbox.enabled` is reserved in v1.0 and warns when configured; OS sandbox wiring remains follow-up work.

## How do you prevent reward hacking?

During fix-test tasks, `loopGuards` blocks writes to detected test files unless the goal explicitly asks to write tests. Repeated identical test failures also trigger a soft-stop so the agent preserves the diff and summarizes instead of spinning.

## How do you measure regressions?

`agent eval --provider faux` copies fixtures to temp repos, applies deterministic faux patches, scores checks, and compares against `.agent/eval/baseline.json`. `agent eval --provider real --scenario <id>` now supports a live smoke scenario when credentials are configured.

## What was the hardest engineering point?

The tricky part is coordinating pi extension order and failure boundaries: policy must block before mutation, loop guards must record budget and patch failures without rolling back user work, and MCP outputs must be truncated with pi's `.content` truncation API before entering model context.

## Red-Team Answers

- `rm -rf`, `curl | sh`, and similar high-risk commands are classified by `policy/command-classifier` and covered in [test/policy/adversarial.test.ts](../test/policy/adversarial.test.ts).
- Writes to `.env`, credentials, and protected paths are covered by [test/policy/path-guard.test.ts](../test/policy/path-guard.test.ts) and [test/policy/engine.test.ts](../test/policy/engine.test.ts).
- Reads outside the repo root are denied for read-like tools in [test/policy/engine.test.ts](../test/policy/engine.test.ts).
- Test-file reward hacking is guarded by `loopGuards` and file classification tests in [test/loop/test-file.test.ts](../test/loop/test-file.test.ts).
- Timeout, token, and patch-location edge cases are covered by [test/runtime/bash-timeout.test.ts](../test/runtime/bash-timeout.test.ts) and [test/loop/failure-signature.test.ts](../test/loop/failure-signature.test.ts).
