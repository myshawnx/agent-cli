import type { ProjectProfile } from "../config/schema.ts";

export interface LoopGuardState {
	goal: string;
	toolCalls: number;
	blocked: boolean;
	tokenBudgetExceeded: boolean;
	totalTokens: number;
	lastFailureSignature?: string;
	repeatedFailures: number;
}

export interface LoopGuardOptions {
	cwd: string;
	goal?: string;
	profile?: ProjectProfile;
	maxToolCalls: number;
	maxFixIterations: number;
	tokenBudget?: number;
}
