import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { renderTaskView, runTrace } from "../../src/cli/commands/trace.ts";

let tempDir: string | undefined;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

function captureStdout(): { chunks: string[]; restore: () => void } {
	const chunks: string[] = [];
	const original = process.stdout.write;
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
		return true;
	}) as typeof process.stdout.write;
	const restore = (): void => {
		process.stdout.write = original;
	};
	return { chunks, restore };
}

describe("renderTaskView", () => {
	it("renders a completed task with modified files", () => {
		const out = renderTaskView({
			goal: "fix auth",
			mode: "workspace-write",
			status: "completed",
			startedAt: "t1",
			endedAt: "t2",
			turns: 2,
			toolCalls: 3,
			modifiedFiles: ["src/auth.ts", "src/login.ts"],
		});
		expect(out).toContain("- Goal: fix auth");
		expect(out).toContain("- Status: completed");
		expect(out).toContain("- Modified files (2):");
		expect(out).toContain("  - src/auth.ts");
	});

	it("renders an empty/unknown task without crashing", () => {
		const out = renderTaskView({
			goal: "",
			mode: "unknown",
			status: "unknown",
			turns: 0,
			toolCalls: 0,
			modifiedFiles: [],
		});
		expect(out).toContain("- Goal: (none recorded)");
		expect(out).toContain("- Modified files: none");
	});
});

describe("agent trace", () => {
	it("projects and prints a real session's trace summary", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "agent-cli-trace-"));
		const sessionDir = join(tempDir, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		const sm = SessionManager.create(tempDir, sessionDir);
		sm.appendCustomEntry("task-meta", { goal: "fix auth", mode: "workspace-write", startedAt: "t1" });
		sm.appendCustomEntry("task-tool-call", { tool: "read" });
		sm.appendCustomEntry("task-modified-file", { path: "src/auth.ts" });
		sm.appendCustomEntry("task-result", {
			status: "completed",
			endedAt: "t2",
			turns: 2,
			toolCalls: 3,
			modifiedFiles: ["src/auth.ts"],
		});
		// pi buffers entries in memory and only flushes to disk once an assistant message
		// exists; append one so getSessionFile() points at a real file for runTrace to open.
		sm.appendMessage(fauxAssistantMessage("done"));
		const file = sm.getSessionFile();
		if (!file) {
			throw new Error("session was not persisted to disk");
		}

		const { chunks, restore } = captureStdout();
		let code: number;
		try {
			code = await runTrace({ cwd: tempDir, session: file });
		} finally {
			restore();
		}

		expect(code).toBe(0);
		const out = chunks.join("");
		expect(out).toContain("fix auth");
		expect(out).toContain("Status: completed");
		expect(out).toContain("src/auth.ts");
		expect(out).toContain(`Session: ${file}`);
	});

	it("returns 1 when no session matches the given id", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "agent-cli-trace-"));
		const originalErr = process.stderr.write;
		process.stderr.write = (() => true) as typeof process.stderr.write;
		try {
			expect(await runTrace({ cwd: tempDir, session: "no-such-session" })).toBe(1);
		} finally {
			process.stderr.write = originalErr;
		}
	});
});
