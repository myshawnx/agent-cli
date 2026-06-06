import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { runDiff } from "../../src/cli/commands/diff.ts";
import { runEval } from "../../src/cli/commands/eval.ts";
import { runMcp } from "../../src/cli/commands/mcp.ts";
import { runResume } from "../../src/cli/commands/resume.ts";
import { runReview } from "../../src/cli/commands/review.ts";
import { runUndo } from "../../src/cli/commands/undo.ts";

const tempDirs = new Set<string>();

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.clear();
});

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.add(dir);
	return dir;
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initGitRepo(): string {
	const cwd = tempDir("agent-cli-git-");
	git(cwd, ["init"]);
	git(cwd, ["config", "user.email", "agent-cli@example.test"]);
	git(cwd, ["config", "user.name", "Agent CLI Test"]);
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src", "index.ts"), "export const value = 1;\n", "utf8");
	git(cwd, ["add", "."]);
	git(cwd, ["commit", "-m", "init"]);
	return cwd;
}

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
	const chunks: string[] = [];
	const original = process.stdout.write;
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
		return true;
	}) as typeof process.stdout.write;
	try {
		return { code: await fn(), out: chunks.join("") };
	} finally {
		process.stdout.write = original;
	}
}

describe("local CLI commands", () => {
	it("prints staged and unstaged git diffs", async () => {
		const cwd = initGitRepo();
		writeFileSync(join(cwd, "src", "index.ts"), "export const value = 2;\n", "utf8");
		mkdirSync(join(cwd, "test"), { recursive: true });
		writeFileSync(join(cwd, "test", "index.test.ts"), "expect(2).toBe(2);\n", "utf8");
		git(cwd, ["add", "test/index.test.ts"]);

		const { code, out } = await captureStdout(() => runDiff({ cwd }));

		expect(code).toBe(0);
		expect(out).toContain("# Agent Diff");
		expect(out).toContain("## Staged");
		expect(out).toContain("test/index.test.ts");
		expect(out).toContain("## Unstaged");
		expect(out).toContain("src/index.ts");
	});

	it("reviews changed files with policy risk and test-change signals", async () => {
		const cwd = initGitRepo();
		writeFileSync(join(cwd, ".env"), "SECRET=demo\n", "utf8");
		mkdirSync(join(cwd, "tests"), { recursive: true });
		writeFileSync(join(cwd, "tests", "index.test.ts"), "expect(true).toBe(true);\n", "utf8");
		git(cwd, ["add", "-f", ".env", "tests/index.test.ts"]);
		expect(git(cwd, ["diff", "--cached", "--name-status"])).toContain(".env");
		expect(git(cwd, ["diff", "--cached", "--name-status", "--", "."])).toContain(".env");

		const { code, out } = await captureStdout(() => runReview({ cwd, mode: "workspace-write" }));

		expect(code).toBe(0);
		expect(out).toContain("# Agent Review");
		expect(out).toContain("Mode: workspace-write");
		expect(out).toContain(".env");
		expect(out).toContain("deny");
		expect(out).toContain("Diff includes test/spec changes.");
	});

	it("stashes tracked and untracked file changes for undo", async () => {
		const cwd = initGitRepo();
		writeFileSync(join(cwd, "src", "index.ts"), "export const value = 3;\n", "utf8");
		writeFileSync(join(cwd, "scratch.txt"), "temporary\n", "utf8");

		const { code, out } = await captureStdout(() => runUndo({ cwd }));

		expect(code).toBe(0);
		expect(out).toContain("agent undo only reverts file changes");
		expect(git(cwd, ["status", "--porcelain"]).trim()).toBe("");
		expect(git(cwd, ["stash", "list"])).toContain("agent-cli-undo-");
	});

	it("manages MCP server config files", async () => {
		const cwd = tempDir("agent-cli-mcp-");

		const empty = await captureStdout(() => runMcp({ cwd, action: "list" }));
		expect(empty.out).toContain("No MCP servers configured");

		const add = await captureStdout(() =>
			runMcp({
				cwd,
				action: "add",
				name: "stub",
				command: "node",
				args: "\"server file.mjs\" --flag 'two words'",
			}),
		);
		expect(add.code).toBe(0);
		expect(add.out).toContain("Configured MCP server stub");

		const config = JSON.parse(readFileSync(join(cwd, ".agent", "mcp.json"), "utf8")) as {
			servers: { stub: { command: string; args?: string[] } };
		};
		expect(config.servers.stub.command).toBe("node");
		expect(config.servers.stub.args).toEqual(["server file.mjs", "--flag", "two words"]);

		const listed = await captureStdout(() => runMcp({ cwd, action: "list" }));
		expect(listed.out).toContain("- stub: node server file.mjs --flag two words");

		const removed = await captureStdout(() => runMcp({ cwd, action: "remove", name: "stub" }));
		expect(removed.out).toContain("Removed MCP server stub.");
		expect(JSON.parse(readFileSync(join(cwd, ".agent", "mcp.json"), "utf8"))).toEqual({ servers: {} });
	});

	it("runs faux eval and writes an explicit baseline when requested", async () => {
		const cwd = tempDir("agent-cli-eval-root-");
		const hadTmp = Object.prototype.hasOwnProperty.call(process.env, "TMPDIR");
		const originalTmp = process.env.TMPDIR;
		process.env.TMPDIR = cwd;
		try {
			mkdirSync(join(cwd, "eval", "fixtures"), { recursive: true });
			mkdirSync(join(cwd, "fixtures", "demo", "src"), { recursive: true });
			writeFileSync(join(cwd, "fixtures", "demo", "src", "index.ts"), "export const value = 1;\n", "utf8");
			writeFileSync(
				join(cwd, "eval", "fixtures", "scenarios.json"),
				JSON.stringify([
					{
						id: "demo-pass",
						repo: "fixtures/demo",
						prompt: "fix demo",
						mode: "workspace-write",
						fauxPatch: { "src/index.ts": "export const value = 2;\n" },
						checks: {
							bugLocated: { paths: ["src/index.ts"] },
							testsPass: { cmd: "builtin:pass" },
							diffTouches: { allow: ["src/**"], deny: [".env"] },
							inBounds: true,
						},
					},
				]),
				"utf8",
			);

			const { code, out } = await captureStdout(() =>
				runEval({ cwd, provider: "faux", scenario: "demo-pass", updateBaseline: true }),
			);

			expect(code).toBe(0);
			expect(out).toContain("# Agent Eval");
			expect(out).toContain("| demo-pass | PASS |");
			expect(out).toContain("Updated");
			expect(JSON.parse(readFileSync(join(cwd, ".agent", "eval", "baseline.json"), "utf8"))).toEqual({
				"demo-pass": true,
			});
		} finally {
			if (hadTmp) {
				process.env.TMPDIR = originalTmp;
			} else {
				Reflect.deleteProperty(process.env, "TMPDIR");
			}
		}
	});

	it("resolves a session path in print resume mode without requiring a follow-up prompt", async () => {
		const cwd = tempDir("agent-cli-resume-");
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		const sessionManager = SessionManager.create(cwd, sessionDir);
		sessionManager.appendMessage(fauxAssistantMessage("previous answer"));
		const sessionPath = sessionManager.getSessionFile();
		if (!sessionPath) {
			throw new Error("session was not persisted to disk");
		}

		const { code, out } = await captureStdout(() =>
			runResume({ cwd, session: sessionPath, printMode: true, mode: "readonly" }),
		);

		expect(code).toBe(0);
		expect(out).toContain(`Resolved session: ${sessionPath}`);
		expect(out).toContain("Pass a prompt after the id to continue it in print mode.");
	});
});
