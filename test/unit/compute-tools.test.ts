import { describe, expect, it } from "vitest";
import { computeTools } from "../../src/runtime/session-factory.ts";

describe("computeTools", () => {
	it("readonly exposes only pi's readonly tool set", () => {
		expect(computeTools("readonly")).toEqual(["read", "grep", "find", "ls"]);
		expect(computeTools("readonly")).not.toContain("edit");
		expect(computeTools("readonly")).not.toContain("write");
		expect(computeTools("readonly")).not.toContain("bash");
	});

	it("non-readonly modes include the write-capable tools for C2 policy gating", () => {
		expect(computeTools("suggest")).toEqual(["read", "grep", "find", "ls", "edit", "write", "bash"]);
		expect(computeTools("workspace-write")).toEqual(["read", "grep", "find", "ls", "edit", "write", "bash"]);
		expect(computeTools("auto")).toEqual(["read", "grep", "find", "ls", "edit", "write", "bash"]);
	});
});
