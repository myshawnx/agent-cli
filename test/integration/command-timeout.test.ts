import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY_CONFIG } from "../../src/config/loader.ts";
import { fauxAssistantMessage, fauxToolCall } from "../pi-ai-faux.ts";
import { type FullTestSession, createFullSession } from "./helpers.ts";

const LONG_COMMAND = 'node -e "setTimeout(() => {}, 5000)"';

describe("command timeout integration", () => {
	let ts: FullTestSession | undefined;

	afterEach(() => ts?.cleanup());

	it("kills a long-running bash command and returns a timeout error", async () => {
		ts = await createFullSession({
			mode: "auto",
			policy: {
				...DEFAULT_POLICY_CONFIG,
				command: { ...DEFAULT_POLICY_CONFIG.command, allow: [...DEFAULT_POLICY_CONFIG.command.allow, LONG_COMMAND] },
				limits: { ...DEFAULT_POLICY_CONFIG.limits, commandTimeoutMs: 300 },
			},
			responses: [
				fauxAssistantMessage(fauxToolCall("bash", { command: LONG_COMMAND }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("The command timed out; preserving the result."),
			],
		});

		await ts.session.prompt("run a long command");

		const toolResult = ts.eventsOfType("tool_execution_end").find((event) => {
			const record = event as { toolName?: string; isError?: boolean };
			return record.toolName === "bash" && record.isError;
		}) as { result?: { content?: Array<{ type: string; text?: string }> } } | undefined;
		const text = toolResult?.result?.content?.find((item) => item.type === "text")?.text ?? "";

		expect(text).toContain("Command timed out after 1 seconds");
	});
});
