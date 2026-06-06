import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalReport, EvalRunResult } from "./types.ts";

export function baselinePath(cwd: string): string {
	return join(cwd, ".agent", "eval", "baseline.json");
}

export function readBaseline(cwd: string): Record<string, boolean> | undefined {
	const path = baselinePath(cwd);
	if (!existsSync(path)) {
		return undefined;
	}
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, boolean>;
}

export function writeBaseline(cwd: string, results: EvalRunResult[]): void {
	const path = baselinePath(cwd);
	mkdirSync(join(cwd, ".agent", "eval"), { recursive: true });
	writeFileSync(
		path,
		JSON.stringify(Object.fromEntries(results.map((r) => [r.scenarioId, r.pass])), null, "\t"),
		"utf8",
	);
}

export function renderReport(report: EvalReport): string {
	const lines = [
		"# Agent Eval",
		"",
		`Provider: ${report.provider}`,
		`Model: ${report.model}`,
		"",
		"| Scenario | Result | Checks | Regression |",
		"|---|---:|---|---|",
	];
	for (const result of report.results) {
		const previous = report.baseline?.[result.scenarioId];
		const regression = previous === true && !result.pass ? "REGRESSION" : previous === undefined ? "new" : "";
		const checks = result.checks.map((check) => `${check.pass ? "✅" : "❌"} ${check.name}`).join(" ");
		lines.push(`| ${result.scenarioId} | ${result.pass ? "PASS" : "FAIL"} | ${checks} | ${regression} |`);
	}
	return `${lines.join("\n")}\n`;
}
