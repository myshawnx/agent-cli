import { describe, expect, it } from "vitest";
import { createFailureSignature, normalizeFailureText } from "../../src/loop/failure-signature.ts";
import { isPatchLocateFailureText, usageTokens } from "../../src/loop/guards.ts";

describe("failure signatures", () => {
	it("normalizes unstable paths and timings", () => {
		expect(normalizeFailureText("FAIL /tmp/a/auth.test.ts 32ms")).toBe("FAIL <path> <time>");
	});

	it("creates stable signatures for repeated failures", () => {
		const first = createFailureSignature({
			isError: true,
			content: [{ type: "text", text: "FAIL /tmp/one/auth.test.ts\nAssertionError: expected 500 to be 401" }],
		});
		const second = createFailureSignature({
			isError: true,
			content: [{ type: "text", text: "FAIL /tmp/two/auth.test.ts\nAssertionError: expected 500 to be 401" }],
		});

		expect(first?.signature).toBe(second?.signature);
		expect(first?.failingTests.length).toBeGreaterThan(0);
	});

	it("ignores successful output", () => {
		expect(
			createFailureSignature({ isError: false, content: [{ type: "text", text: "Tests 3 passed" }] }),
		).toBeUndefined();
	});

	it("counts usage with totalTokens, falling back to individual fields", () => {
		const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

		expect(usageTokens({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 123, cost })).toBe(123);
		expect(usageTokens({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 0, cost })).toBe(100);
		expect(usageTokens(undefined)).toBe(0);
	});

	it("detects edit locate failures without matching unrelated errors", () => {
		expect(
			isPatchLocateFailureText(
				"Could not find the exact text in src/app.ts. The old text must match exactly including all whitespace and newlines.",
			),
		).toBe(true);
		expect(
			isPatchLocateFailureText("Found 2 occurrences of edits[0] in src/app.ts. Each oldText must be unique."),
		).toBe(true);
		expect(isPatchLocateFailureText("Command exited with code 1")).toBe(false);
	});
});
