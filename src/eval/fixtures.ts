import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { EvalScenario } from "./types.ts";

export function loadScenarios(root: string): EvalScenario[] {
	const path = join(root, "eval", "fixtures", "scenarios.json");
	return JSON.parse(readFileSync(path, "utf8")) as EvalScenario[];
}

export function copyFixtureToTemp(root: string, repo: string): string {
	const source = resolve(root, repo);
	const dest = join(mkdtempSync(join(tmpdir(), "agent-cli-eval-")), basename(repo));
	cpSync(source, dest, { recursive: true, dereference: true });
	return dest;
}
