import { describe, expect, it } from "vitest";
import { createFailureSignature, normalizeFailureText } from "../../src/loop/failure-signature.ts";

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
		expect(createFailureSignature({ isError: false, content: [{ type: "text", text: "Tests 3 passed" }] })).toBeUndefined();
	});
});

