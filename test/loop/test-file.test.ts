import { describe, expect, it } from "vitest";
import { allowsTestWrites, isTestFile, isTestFixGoal } from "../../src/loop/test-file.ts";

describe("test-file guard helpers", () => {
	it("detects conventional test files and configured test dirs", () => {
		expect(isTestFile("src/auth.test.ts")).toBe(true);
		expect(isTestFile("tests/auth.py")).toBe(true);
		expect(
			isTestFile("integration/auth.ts", {
				language: "typescript",
				packageManager: "npm",
				sourceDirs: [],
				testDirs: ["integration"],
				commands: {},
			}),
		).toBe(true);
		expect(isTestFile("src/auth.ts")).toBe(false);
	});

	it("activates reward-hacking guard only for fix-test goals", () => {
		expect(isTestFixGoal("fix the failing tests without changing requirements")).toBe(true);
		expect(isTestFixGoal("修复测试失败的问题")).toBe(true);
		expect(isTestFixGoal("explain the repo")).toBe(false);
	});

	it("allows explicit test-authoring tasks to edit tests", () => {
		expect(allowsTestWrites("add a regression test for auth")).toBe(true);
		expect(allowsTestWrites("补一个登录测试用例")).toBe(true);
		expect(allowsTestWrites("fix implementation so tests pass")).toBe(false);
	});
});
