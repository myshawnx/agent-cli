#!/usr/bin/env bash
set -u

mode="${MCP_TEST_MODE:-echo}"

if [[ -n "${MCP_SPAWN_LOG:-}" ]]; then
	printf '%s\n' "$$" >> "$MCP_SPAWN_LOG"
fi

if [[ "$mode" == "timeout" ]]; then
	while true; do
		sleep 1
	done
fi

send_initialize() {
	local id="$1"
	printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"stub-server","version":"1.0.0"}}}\n' "$id"
}

send_tools() {
	local id="$1"
	printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"echo","description":"echo","inputSchema":{"type":"object","properties":{}}}]}}\n' "$id"
}

send_echo() {
	local id="$1"
	printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"{}"}]}}\n' "$id"
}

while IFS= read -r line; do
	id=0
	if [[ "$line" =~ \"id\":([0-9]+) ]]; then
		id="${BASH_REMATCH[1]}"
	fi

	if [[ "$line" == *'"method":"initialize"'* ]]; then
		send_initialize "$id"
	elif [[ "$line" == *'"method":"tools/list"'* ]]; then
		send_tools "$id"
	elif [[ "$line" == *'"method":"tools/call"'* && "$mode" == "call-timeout" ]]; then
		while true; do
			sleep 1
		done
	elif [[ "$line" == *'"method":"tools/call"'* && "$mode" == "crash-on-call" ]]; then
		exit 1
	elif [[ "$line" == *'"method":"tools/call"'* ]]; then
		send_echo "$id"
	fi
done

while true; do
	sleep 1
done
