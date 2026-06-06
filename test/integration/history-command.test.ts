import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHistory } from "../../src/cli/commands/history.ts";

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
	return {
		chunks,
		restore: () => {
			process.stdout.write = original;
		},
	};
}

describe("agent history", () => {
	it("treats a missing session directory as empty history", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "agent-cli-history-"));
		const { chunks, restore } = captureStdout();
		try {
			expect(await runHistory({ cwd: tempDir })).toBe(0);
		} finally {
			restore();
		}
		expect(chunks.join("")).toContain("No pi sessions found for this cwd.");
	});
});
