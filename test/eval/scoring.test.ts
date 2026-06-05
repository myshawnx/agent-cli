import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedFiles, scoreScenario, snapshotFiles } from "../../src/eval/scoring.ts";
import type { EvalScenario } from "../../src/eval/types.ts";

function tempRepoSnapshot(): { cwd: string; baseline: ReturnType<typeof snapshotFiles> } {
	const cwd = mkdtempSync(join(tmpdir(), "agent-cli-eval-score-"));
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src", "index.ts"), "export const ok = true;\n", "utf8");
	return { cwd, baseline: snapshotFiles(cwd) };
}

describe("eval scoring", () => {
	it("checks changed files, tests, and bounds", () => {
		const { cwd, baseline } = tempRepoSnapshot();
		writeFileSync(join(cwd, "src", "index.ts"), "export const ok = false;\n", "utf8");
		const files = changedFiles(cwd, baseline);
		const scenario: EvalScenario = {
			id: "demo",
			repo: "fixtures/demo",
			prompt: "fix demo",
			mode: "workspace-write",
			checks: {
				bugLocated: { paths: ["src/index.ts"] },
				testsPass: { cmd: "builtin:pass" },
				diffTouches: { allow: ["src/**"], deny: ["test/**"] },
				inBounds: true,
			},
		};

		expect(files).toEqual(["src/index.ts"]);
		expect(scoreScenario({ scenario, cwd, changedFiles: files }).every((check) => check.pass)).toBe(true);
	});
});
