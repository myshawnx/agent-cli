import { describe, expect, it } from "vitest";
import { drive } from "../../src/runtime/driver.ts";

describe("abort failsafe", () => {
	it("preserves the diff and records a failed task-result on SIGTERM", async () => {
		let listener: ((event: { type: string }) => void) | undefined;
		let disposed = false;
		let promptStarted: (() => void) | undefined;
		const promptStartedPromise = new Promise<void>((resolve) => {
			promptStarted = resolve;
		});
		const branch: Array<{ type: "custom"; customType: string; data: Record<string, unknown> }> = [
			{ type: "custom", customType: "task-modified-file", data: { path: "src/login.ts" } },
		];
		const session = {
			subscribe: (fn: (event: { type: string }) => void) => {
				listener = fn;
				return () => {
					listener = undefined;
				};
			},
			bindExtensions: async () => {},
			prompt: async () => {
				promptStarted?.();
				listener?.({ type: "tool_execution_start" });
				await new Promise(() => {});
			},
			dispose: () => {
				disposed = true;
			},
			getLastAssistantText: () => "",
			messages: [],
			sessionManager: {
				getBranch: () => branch,
				appendCustomEntry: (customType: string, data: Record<string, unknown>) => {
					branch.push({ type: "custom", customType, data });
				},
			},
		};

		const run = drive(session as unknown as Parameters<typeof drive>[0], {
			printMode: true,
			prompt: "fix the login bug",
		});
		await promptStartedPromise;

		process.emit("SIGTERM", "SIGTERM");

		await expect(run).rejects.toThrow("SIGTERM received; current diff preserved for handoff");
		expect(disposed).toBe(true);

		const abort = branch.find((entry) => entry.customType === "abort-preserved");
		expect(abort?.data.signal).toBe("SIGTERM");
		expect(abort?.data.preserveDiff).toBe(true);
		expect(abort?.data.modifiedFiles).toEqual(["src/login.ts"]);

		const result = branch.find((entry) => entry.customType === "task-result");
		expect(result?.data.status).toBe("failed");
		expect(result?.data.toolCalls).toBe(1);
		expect(result?.data.modifiedFiles).toEqual(["src/login.ts"]);
	});
});
