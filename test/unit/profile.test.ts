import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMemory, renderMemoryForPrompt } from "../../src/context/memory.ts";
import { detectProfile, loadProfile, renderProfileForPrompt, saveProfile } from "../../src/context/profile.ts";

const fixtures = resolve("fixtures");
let tempDir: string | undefined;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("detectProfile", () => {
	it("detects the pnpm TypeScript Hono fixture", async () => {
		const p = await detectProfile(join(fixtures, "hono-api"));
		expect(p.language).toBe("typescript");
		expect(p.packageManager).toBe("pnpm");
		expect(p.framework).toBe("hono");
		expect(p.testFramework).toBe("vitest");
		expect(p.sourceDirs).toEqual(["src"]);
		expect(p.testDirs).toEqual(["test"]);
		expect(p.commands).toMatchObject({ test: "pnpm test", lint: "pnpm run lint", build: "pnpm run build" });
	});

	it("detects an npm TypeScript fixture", async () => {
		const p = await detectProfile(join(fixtures, "npm-ts"));
		expect(p.language).toBe("typescript");
		expect(p.packageManager).toBe("npm");
		expect(p.framework).toBe("express");
		expect(p.testFramework).toBe("jest");
		expect(p.commands).toMatchObject({ test: "npm test", build: "npm run build" });
	});

	it("detects a Python pyproject fixture", async () => {
		const p = await detectProfile(join(fixtures, "python-pyproject"));
		expect(p.language).toBe("python");
		expect(p.packageManager).toBe("pip");
		expect(p.testFramework).toBe("pytest");
		expect(p.commands.test).toBe("pytest");
		expect(p.sourceDirs).toEqual(["src"]);
		expect(p.testDirs).toEqual(["tests"]);
	});

	it("detects a Go module fixture", async () => {
		const p = await detectProfile(join(fixtures, "go-mod"));
		expect(p.language).toBe("go");
		expect(p.packageManager).toBe("go");
		expect(p.commands).toMatchObject({ test: "go test ./...", build: "go build ./..." });
		expect(p.sourceDirs).toEqual(["pkg"]);
		expect(p.testDirs).toEqual(["tests"]);
	});
});

describe("profile persistence and prompt rendering", () => {
	it("round-trips a saved profile through the C0 loader/writer path", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "agent-cli-profile-"));
		const p = await detectProfile(join(fixtures, "hono-api"));
		expect(saveProfile(tempDir, p)).toEqual([]);
		expect(loadProfile(tempDir)).toEqual(p);
	});

	it("renders profile and memory prompt blocks", async () => {
		const p = await detectProfile(join(fixtures, "hono-api"));
		const profilePrompt = renderProfileForPrompt(p);
		expect(profilePrompt).toContain("Package manager: pnpm");
		expect(profilePrompt).toContain("test=pnpm test");

		expect(loadMemory(join(fixtures, "hono-api"))).toBe("");
		expect(renderMemoryForPrompt("")).toBe("");
		expect(renderMemoryForPrompt("Use small PRs")).toContain("Use small PRs");
	});
});
