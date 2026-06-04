import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/commands/init.ts";

let tempDir: string | undefined;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

function copyFixture(name: string): string {
	tempDir = mkdtempSync(join(tmpdir(), "agent-cli-init-"));
	cpSync(resolve("fixtures", name), tempDir, { recursive: true });
	return tempDir;
}

describe("agent init", () => {
	it("detects profile and scaffolds .agent/ files idempotently", async () => {
		const cwd = copyFixture("hono-api");
		const originalWrite = process.stdout.write;
		process.stdout.write = (() => true) as typeof process.stdout.write;
		try {
			expect(await runInit({ cwd })).toBe(0);
		} finally {
			process.stdout.write = originalWrite;
		}

		const agentDir = join(cwd, ".agent");
		const profilePath = join(agentDir, "project-profile.json");
		const memoryPath = join(agentDir, "memory.md");
		const policyPath = join(agentDir, "policy.json");

		expect(existsSync(profilePath)).toBe(true);
		expect(existsSync(memoryPath)).toBe(true);
		expect(existsSync(policyPath)).toBe(true);
		expect(existsSync(join(agentDir, "mcp.json"))).toBe(false);

		const profile = JSON.parse(readFileSync(profilePath, "utf8")) as {
			language: string;
			packageManager: string;
			framework?: string;
			commands: { test?: string };
		};
		expect(profile.language).toBe("typescript");
		expect(profile.packageManager).toBe("pnpm");
		expect(profile.framework).toBe("hono");
		expect(profile.commands.test).toBe("pnpm test");
		expect(readFileSync(memoryPath, "utf8")).toContain("# Project memory");
		expect(readFileSync(policyPath, "utf8")).toContain("commandTimeoutMs");

		writeFileSync(memoryPath, "custom memory", "utf8");
		expect(await runInit({ cwd })).toBe(0);
		expect(readFileSync(memoryPath, "utf8")).toBe("custom memory");

		expect(await runInit({ cwd, force: true })).toBe(0);
		expect(readFileSync(memoryPath, "utf8")).toContain("# Project memory");
	});
});
