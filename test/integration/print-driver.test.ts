import { describe, expect, it } from "vitest";
import { type TokenUsage, drive } from "../../src/runtime/driver.ts";

const zeroUsage: TokenUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("print driver", () => {
	it("streams text_delta output, exposes usage, and disposes the session", async () => {
		let listener: ((event: unknown) => void) | undefined;
		let disposed = false;
		const session = {
			subscribe: (fn: (event: unknown) => void) => {
				listener = fn;
				return () => {
					listener = undefined;
				};
			},
			prompt: async () => {
				listener?.({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "hello from driver" },
				});
				listener?.({
					type: "agent_end",
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "hello from driver" }],
							usage: zeroUsage,
						},
					],
				});
			},
			dispose: () => {
				disposed = true;
			},
			getLastAssistantText: () => "hello from fallback",
			messages: [],
		};

		const originalWrite = process.stdout.write;
		let stdout = "";
		let usage: TokenUsage | undefined;
		process.stdout.write = ((chunk: string | Uint8Array) => {
			stdout += chunk.toString();
			return true;
		}) as typeof process.stdout.write;
		try {
			await drive(session as unknown as Parameters<typeof drive>[0], {
				printMode: true,
				prompt: "say hello",
				onUsage: (u) => {
					usage = u;
				},
			});
		} finally {
			process.stdout.write = originalWrite;
		}

		expect(stdout).toBe("hello from driver\n");
		expect(usage).toEqual(zeroUsage);
		expect(disposed).toBe(true);
	});
});
