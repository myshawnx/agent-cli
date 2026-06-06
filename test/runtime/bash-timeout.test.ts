import { describe, expect, it, vi } from "vitest";
import { applyCommandTimeout, commandTimeoutSeconds, withCommandTimeout } from "../../src/runtime/bash-timeout-core.ts";

describe("bash command timeout", () => {
	it("converts configured milliseconds to bash timeout seconds", () => {
		expect(commandTimeoutSeconds(undefined)).toBeUndefined();
		expect(commandTimeoutSeconds(0)).toBeUndefined();
		expect(commandTimeoutSeconds(1_500)).toBe(2);
	});

	it("caps bash tool input timeout in seconds", () => {
		const event = { type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "npm test", timeout: 60 } };

		applyCommandTimeout(event as Parameters<typeof applyCommandTimeout>[0], 1_500);

		expect(event.input.timeout).toBe(2);
	});

	it("aborts the wrapped operation when the configured timeout expires", async () => {
		vi.useFakeTimers();
		try {
			const run = withCommandTimeout(
				1_000,
				undefined,
				(signal) =>
					new Promise((resolve, reject) => {
						signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}),
			);
			const assertion = expect(run).rejects.toThrow("Command timed out after 1 seconds");

			await vi.advanceTimersByTimeAsync(1_000);

			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});
});
