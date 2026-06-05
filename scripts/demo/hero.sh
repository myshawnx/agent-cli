#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FAUX=0
if [[ "${1:-}" == "--faux" ]]; then
	FAUX=1
fi
MODE="real/manual"
if [[ "$FAUX" == "1" ]]; then
	MODE="faux/offline"
fi

echo "Agent CLI hero demo ($MODE)"
echo
echo "Step 1: build CLI"
npm run build
echo
echo "Step 2: policy review of current diff"
node "$ROOT/dist/cli.js" review --cwd "$ROOT" --mode workspace-write || true
echo
echo "Step 3: deterministic eval matrix"
node "$ROOT/dist/cli.js" eval --cwd "$ROOT" --provider faux
echo
echo "Step 4: MCP config smoke"
node "$ROOT/dist/cli.js" mcp list --cwd "$ROOT"
echo
echo "Step 5: file-only undo boundary"
echo "agent undo uses git stash --include-untracked and is intentionally not run on this dirty demo checkout."
echo
if [[ "$FAUX" == "1" ]]; then
	echo "Faux demo complete: no model key, no network, deterministic output."
else
	echo "For a live provider run, configure ANTHROPIC_API_KEY and use agent -p/interactive prompts."
fi
