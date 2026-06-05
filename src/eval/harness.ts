import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { copyFixtureToTemp, loadScenarios } from "./fixtures.ts";
import { changedFiles, scoreScenario, snapshotFiles } from "./scoring.ts";
import type { EvalRunResult, EvalScenario } from "./types.ts";

export interface EvalHarnessOptions {
	root: string;
	provider: "faux" | "real";
	model: string;
	scenario?: string;
}

function applyFauxPatch(cwd: string, patch: Record<string, string> | undefined): void {
	for (const [relativePath, content] of Object.entries(patch ?? {})) {
		const target = join(cwd, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content, "utf8");
	}
}

async function runScenario(root: string, scenario: EvalScenario, opts: EvalHarnessOptions): Promise<EvalRunResult> {
	const tempDir = copyFixtureToTemp(root, scenario.repo);
	const baseline = snapshotFiles(tempDir);
	if (opts.provider === "faux") {
		applyFauxPatch(tempDir, scenario.fauxPatch);
	} else {
		throw new Error("real eval provider is reserved for manual C6 hardening; use --provider faux for deterministic runs");
	}
	const denies = 0;
	const confirmRejects = 0;
	const files = changedFiles(tempDir, baseline);
	const checks = scoreScenario({ scenario, cwd: tempDir, changedFiles: files, denies, confirmRejects });
	return {
		scenarioId: scenario.id,
		model: opts.model,
		provider: opts.provider,
		pass: checks.every((check) => check.pass),
		checks,
		tempDir,
		changedFiles: files,
		denies,
		confirmRejects,
	};
}

export async function runEvalHarness(opts: EvalHarnessOptions): Promise<EvalRunResult[]> {
	const scenarios = loadScenarios(opts.root).filter((scenario) => !opts.scenario || scenario.id === opts.scenario);
	if (scenarios.length === 0) {
		throw new Error(opts.scenario ? `unknown eval scenario: ${opts.scenario}` : "no eval scenarios configured");
	}
	const results: EvalRunResult[] = [];
	for (const scenario of scenarios) {
		results.push(await runScenario(opts.root, scenario, opts));
	}
	return results;
}
