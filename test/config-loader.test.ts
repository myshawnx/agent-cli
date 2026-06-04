/**
 * Config loader unit tests (pure function — no LLM, no pi runtime).
 *
 * Three states: valid `.agent/`, invalid/malformed `.agent/`, missing `.agent/`.
 * C0 acceptance criteria #8 requires all three loader states are testable.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../src/config/loader.ts";
import { loadAgentConfig } from "../src/config/loader.ts";

let tempDir: string;

beforeEach(() => {
	tempDir = join(
		new URL(".", import.meta.url).pathname.replace(/^\//, ""),
		`cl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(join(tempDir, ".agent"), { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function writeAgentFile(name: string, content: string): void {
	writeFileSync(join(tempDir, ".agent", name), content, "utf8");
}

describe("loadAgentConfig", () => {
	it("returns full defaults when .agent/ is missing", () => {
		rmSync(join(tempDir, ".agent"), { recursive: true, force: true });
		const cfg = loadAgentConfig(tempDir);
		expect(cfg.diagnostics).toHaveLength(1);
		expect(cfg.diagnostics[0]?.level).toBe("warn");
		expect(cfg.policy.limits.maxToolCalls).toBe(50);
		expect(cfg.profile).toBeNull();
		expect(cfg.memory).toBe("");
	});

	it("loads a valid policy.json (partial fills defaults)", () => {
		writeAgentFile("policy.json", JSON.stringify({ limits: { maxToolCalls: 10 } }));
		const cfg = loadAgentConfig(tempDir);
		expect(cfg.diagnostics).toHaveLength(0);
		// Explicit field should be picked up
		expect(cfg.policy.limits.maxToolCalls).toBe(10);
		// Omitted fields should fall back to defaults
		expect(cfg.policy.limits.maxFixIterations).toBe(5);
	});

	it("returns defaults + error diagnostic on invalid JSON", () => {
		writeAgentFile("policy.json", "not-json");
		const cfg = loadAgentConfig(tempDir);
		expect(cfg.diagnostics.some((d) => d.level === "error")).toBe(true);
		// Degrades to defaults (never throws)
		expect(cfg.policy.limits.maxToolCalls).toBe(50);
	});

	it("returns defaults + error diagnostic on schema mismatch", () => {
		writeAgentFile("policy.json", JSON.stringify({ limits: { maxToolCalls: "not-a-number" } }));
		const cfg = loadAgentConfig(tempDir);
		expect(cfg.diagnostics.some((d) => d.level === "error")).toBe(true);
		expect(cfg.policy.limits.maxToolCalls).toBe(50); // default
	});

	it("loads a valid project-profile.json", () => {
		writeAgentFile(
			"project-profile.json",
			JSON.stringify({
				language: "typescript",
				packageManager: "pnpm",
				sourceDirs: ["src"],
				testDirs: ["test"],
			}),
		);
		const cfg = loadAgentConfig(tempDir);
		expect(cfg.profile).not.toBeNull();
		expect(cfg.profile?.language).toBe("typescript");
	});

	it("loads memory.md as plain text", () => {
		writeAgentFile("memory.md", "remember: this project uses hono");
		const cfg = loadAgentConfig(tempDir);
		expect(cfg.memory).toContain("hono");
	});

	it("keeps empty memory when memory.md is absent", () => {
		const cfg = loadAgentConfig(tempDir);
		expect(cfg.memory).toBe("");
	});
});
