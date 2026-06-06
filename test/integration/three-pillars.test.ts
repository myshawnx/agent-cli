/**
 * C6 T6.1 — three-pillars integration: in one real (faux-provider) headless session,
 * `policyGateway` + `loopGuards` + `traceRecorder` + `mcpAdapter` are all mounted via
 * `buildResourceLoader` and must coexist without breaking one another. We drive a turn
 * whose model issues a policy-denied tool call, then assert each factory left its
 * observable mark in the single pi session (overview §3.4 fixed hook order).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "../pi-ai-faux.ts";
import { type FullTestSession, createFullSession } from "./helpers.ts";
const STUB_SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "fixtures", "stub-server.sh");

describe("C6 three-pillars integration", () => {
	let ts: FullTestSession | undefined;

	afterEach(() => ts?.cleanup());

	it("mounts policy + loop + trace + mcp in one session without breaking each other", async () => {
		ts = await createFullSession({
			mode: "workspace-write",
			goal: "fix the failing login bug",
			beforeStart: (cwd) => {
				mkdirSync(join(cwd, ".agent"), { recursive: true });
				writeFileSync(
					join(cwd, ".agent", "mcp.json"),
					JSON.stringify({
						servers: { stub: { command: "bash", args: [STUB_SERVER], env: { MCP_TEST_MODE: "echo" } } },
					}),
				);
			},
			responses: [
				// `stopReason: "toolUse"` makes pi execute the tool call (the default "stop"
				// ends the turn). Policy must deny this read (protected path) before it runs.
				fauxAssistantMessage(fauxToolCall("read", { path: ".env" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("I will not read protected files; summarizing instead."),
			],
		});

		await ts.session.prompt("inspect the project");

		const entries = ts.customEntries();
		const kinds = entries.map((e) => e.customType);

		// traceRecorder: per-agent task envelope.
		expect(kinds).toContain("task-meta");
		expect(kinds).toContain("task-result");
		// policyGateway: recorded the deny (the single source of truth for inBounds).
		const deny = entries.find((e) => e.customType === "policy-deny");
		expect(deny?.data.tool).toBe("read");
		// loopGuards: installed its per-agent guard entry.
		expect(kinds).toContain("loop-guard");
		// mcpAdapter: the remote tool is exposed under the mcp__ namespace.
		await vi.waitFor(() => expect(ts?.session.getActiveToolNames()).toContain("mcp__stub__echo"));
	});

	it("short-circuits later tool_call hooks when policy blocks first", async () => {
		const laterToolCall = vi.fn();
		ts = await createFullSession({
			mode: "workspace-write",
			extraFactories: [
				(pi) => {
					pi.on("tool_call", (event) => {
						laterToolCall(event.toolName);
						return undefined;
					});
				},
			],
			responses: [
				fauxAssistantMessage(fauxToolCall("read", { path: ".env" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("blocked"),
			],
		});

		await ts.session.prompt("read the env file");

		expect(ts.customEntries().some((entry) => entry.customType === "policy-deny")).toBe(true);
		expect(laterToolCall).not.toHaveBeenCalled();
	});
});
