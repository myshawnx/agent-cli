import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_POLICY_CONFIG } from "../config/loader.ts";
import { loadMemory } from "../context/memory.ts";
import { detectProfile } from "../context/profile.ts";
import type { ProjectContext } from "../context/types.ts";
import { buildResourceLoader } from "../runtime/resource-loader.ts";
import { DEFAULT_MODEL_ID, buildSession } from "../runtime/session-factory.ts";
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

function policyCounts(entries: Array<{ type: string; customType?: string; data?: unknown }>): {
	denies: number;
	confirmRejects: number;
} {
	const policyDenies = entries.filter((entry) => entry.type === "custom" && entry.customType === "policy-deny");
	const confirmRejects = policyDenies.filter((entry) => {
		const reason = (entry.data as { reason?: unknown } | undefined)?.reason;
		return typeof reason === "string" && (/用户拒绝/.test(reason) || /无 UI/.test(reason));
	}).length;
	return { denies: policyDenies.length, confirmRejects };
}

async function runRealProviderScenario(
	root: string,
	scenario: EvalScenario,
	tempDir: string,
	opts: EvalHarnessOptions,
) {
	const profile = await detectProfile(tempDir);
	const ctx: ProjectContext = {
		cwd: tempDir,
		goal: scenario.prompt,
		mode: scenario.mode,
		policy: DEFAULT_POLICY_CONFIG,
		profile,
		memory: loadMemory(tempDir),
	};
	const resourceLoader = buildResourceLoader(ctx);
	await resourceLoader.reload();
	const { session, modelFallbackMessage } = await buildSession({
		cwd: tempDir,
		mode: scenario.mode,
		resourceLoader,
		modelId: opts.model === "default-real" ? DEFAULT_MODEL_ID : opts.model,
	});
	if (modelFallbackMessage) {
		process.stderr.write(`${modelFallbackMessage}\n`);
	}
	try {
		await session.prompt(scenario.prompt);
		return policyCounts(session.sessionManager.getEntries());
	} finally {
		session.dispose();
	}
}

async function runScenario(root: string, scenario: EvalScenario, opts: EvalHarnessOptions): Promise<EvalRunResult> {
	const tempDir = copyFixtureToTemp(root, scenario.repo);
	const baseline = snapshotFiles(tempDir);
	let denies = 0;
	let confirmRejects = 0;
	if (opts.provider === "faux") {
		applyFauxPatch(tempDir, scenario.fauxPatch);
	} else {
		({ denies, confirmRejects } = await runRealProviderScenario(root, scenario, tempDir, opts));
	}
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
