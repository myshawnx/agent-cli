import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY_CONFIG } from "../../src/config/loader.ts";
import { fauxAssistantMessage, fauxToolCall } from "../pi-ai-faux.ts";
import { type FullTestSession, createFullSession } from "./helpers.ts";

describe("token budget integration", () => {
	let ts: FullTestSession | undefined;

	afterEach(() => ts?.cleanup());

	it("soft-stops when usage exceeds the budget and blocks the next tool call", async () => {
		ts = await createFullSession({
			mode: "workspace-write",
			policy: {
				...DEFAULT_POLICY_CONFIG,
				limits: { ...DEFAULT_POLICY_CONFIG.limits, tokenBudget: 5 },
			},
			fauxOptions: { tokenSize: { min: 20, max: 20 } },
			responses: [
				fauxAssistantMessage("This first assistant response deliberately consumes enough faux tokens."),
				fauxAssistantMessage(fauxToolCall("read", { path: "package.json" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("I should not get a real file result because the guard blocks the call."),
			],
		});

		await ts.session.prompt("inspect package metadata");

		const entries = ts.customEntries();
		const kinds = entries.map((entry) => entry.customType);
		expect(kinds).toContain("loop-guard");
		expect(
			entries.some((entry) => entry.customType === "loop-guard" && entry.data.kind === "token-budget-exceeded"),
		).toBe(true);
		expect(entries.some((entry) => entry.customType === "loop-guard" && entry.data.kind === "token-budget-block")).toBe(
			true,
		);

		const blockedRead = ts.eventsOfType("tool_execution_end").find((event) => {
			const record = event as { toolName?: string; isError?: boolean; result?: { content?: Array<{ text?: string }> } };
			const text = record.result?.content?.map((item) => item.text ?? "").join("\n") ?? "";
			return record.toolName === "read" && record.isError && text.includes("tokenBudget exceeded");
		});
		expect(blockedRead).toBeDefined();
	});
});
