# Interview QA

## Why build on pi instead of forking it?

The project goal is to show product-level agent engineering, not to reimplement a harness. pi supplies the loop, tools, and session tree. Agent CLI adds team-facing layers: policy, loop guards, evals, memory, MCP, and release ergonomics.

## Is the policy layer a sandbox?

No. It is a declarative speed bump that classifies tool calls before execution. It catches common risky strings and sensitive paths, but it is not an OS boundary. The README and help text explicitly say this.

## How do you prevent reward hacking?

During fix-test tasks, `loopGuards` blocks writes to files detected as tests unless the goal explicitly asks to write tests. This prevents the simple failure mode where an agent deletes assertions to make tests pass.

## How do you measure regressions?

`agent eval --provider faux` copies planted-bug fixtures to temp repos, applies deterministic faux patches, scores checks, and compares against `.agent/eval/baseline.json`.

## Why is undo file-only?

Commands can install packages, write databases, or trigger remote side effects. `agent undo` intentionally uses `git stash --include-untracked` and states that command side effects are not reverted.

