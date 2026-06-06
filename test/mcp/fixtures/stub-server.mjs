import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.MCP_TEST_MODE ?? "echo";
const lines = createInterface({ input: process.stdin });
process.stdin.resume();

// Record every spawn so tests can prove the persistent client reuses one child
// process across initialize / tools/list / tools/call instead of respawning.
const spawnLog = process.env.MCP_SPAWN_LOG;
if (spawnLog) {
	appendFileSync(spawnLog, `${process.pid}\n`);
}

if (mode === "timeout" || mode === "call-timeout") {
	setInterval(() => {}, 1_000);
}

function send(id, result) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

lines.on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}

	if (mode === "timeout") {
		return;
	}

	if (message.method === "initialize") {
		send(message.id, {
			protocolVersion: "2024-11-05",
			capabilities: {},
			serverInfo: { name: "stub-server", version: "1.0.0" },
		});
		return;
	}

	if (message.method === "tools/list") {
		send(message.id, {
			tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: {} } }],
		});
		return;
	}

	if (message.method === "tools/call" && mode === "call-timeout") {
		return;
	}

	// Simulate a server crash mid-call: exit before responding so the client sees an
	// unexpected close and must reject the in-flight request rather than hang.
	if (message.method === "tools/call" && mode === "crash-on-call") {
		process.exit(1);
	}

	if (message.method === "tools/call" && mode === "echo") {
		send(message.id, { content: [{ type: "text", text: JSON.stringify(message.params?.arguments ?? {}) }] });
	}
});
