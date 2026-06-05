# Release Checklist

1. Run `npm install --ignore-scripts` on a clean checkout.
2. Run `npm run typecheck`.
3. Run `npm test` when the local environment allows Vitest/esbuild child processes.
4. Run `npm run build` and verify `node dist/cli.js --help`.
5. Run `agent eval --provider faux --update-baseline` only when intentionally updating `.agent/eval/baseline.json`.
6. Run `npm pack` and inspect the tarball contents.
7. Tag the release after all C3-C6 commits are pushed: `git tag v1.0.0 && git push origin v1.0.0`.

