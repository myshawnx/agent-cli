import { runEvalHarness } from "../../eval/harness.ts";
import { readBaseline, renderReport, writeBaseline } from "../../eval/report.ts";

export interface EvalOptions {
	cwd: string;
	provider: "faux" | "real";
	model?: string;
	scenario?: string;
	updateBaseline?: boolean;
}

export async function runEval(opts: EvalOptions): Promise<number> {
	const model = opts.model ?? (opts.provider === "faux" ? "faux-deterministic" : "default-real");
	const results = await runEvalHarness({ root: opts.cwd, provider: opts.provider, model, scenario: opts.scenario });
	const baseline = readBaseline(opts.cwd);
	process.stdout.write(renderReport({ provider: opts.provider, model, results, baseline }));
	if (opts.updateBaseline) {
		writeBaseline(opts.cwd, results);
		process.stdout.write(`Updated ${opts.cwd}/.agent/eval/baseline.json\n`);
	}
	return results.every((result) => result.pass) ? 0 : 1;
}

