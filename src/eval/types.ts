import type { ApprovalMode } from "../policy/types.ts";

export interface EvalScenario {
	id: string;
	repo: string;
	prompt: string;
	mode: ApprovalMode;
	fauxPatch?: Record<string, string>;
	checks: {
		bugLocated?: { paths: string[] };
		testsPass?: { cmd: string };
		diffTouches?: { allow?: string[]; deny?: string[] };
		addedTest?: { optional?: boolean; patterns?: string[] };
		inBounds?: boolean;
	};
}

export interface CheckResult {
	name: string;
	pass: boolean;
	reason: string;
}

export interface EvalRunResult {
	scenarioId: string;
	model: string;
	provider: "faux" | "real";
	pass: boolean;
	checks: CheckResult[];
	tempDir: string;
	changedFiles: string[];
	denies: number;
	confirmRejects: number;
}

export interface EvalReport {
	model: string;
	provider: "faux" | "real";
	results: EvalRunResult[];
	baseline?: Record<string, boolean>;
}

