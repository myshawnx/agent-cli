# Release Checklist

1. Run `npm install` on a clean checkout. If lifecycle scripts are disabled, run `node scripts/dedupe-pi-ai.mjs` before faux-provider tests.
2. Run `npm run typecheck`.
3. Follow [`docs/testing-reliability-checklist.md`](testing-reliability-checklist.md) for the full L0-L4 validation flow.
4. Run `npm test` when the local environment allows Vitest/esbuild child processes.
5. Run `npm run build` and verify `node dist/cli.js --help` and `node dist/cli.js --version`.
6. Run `agent eval --provider faux --update-baseline` only when intentionally updating `.agent/eval/baseline.json`.
7. Run `npm pack` and inspect the tarball contents.
8. Tag the release after all C3-C6 commits are pushed: `git tag v1.0.0 && git push origin v1.0.0`.
