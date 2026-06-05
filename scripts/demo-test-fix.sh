#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/fixtures/hono-api"

echo "Agent CLI C3 demo: loop guards + trace + diff/undo"
echo "Fixture: $FIXTURE"
echo
echo "1) Initialize fixture profile"
node "$ROOT/dist/cli.js" init --cwd "$FIXTURE" || true
echo
echo "2) Show current diff"
node "$ROOT/dist/cli.js" diff --cwd "$FIXTURE"
echo
echo "3) Loop-guard demo prompt (requires a configured model if you run it live)"
echo "node $ROOT/dist/cli.js --cwd $FIXTURE --mode workspace-write \"fix failing tests without editing tests\""
echo
echo "4) Undo boundary"
echo "agent undo only reverts file changes; command side effects are not undone."

