import type { ProjectProfile } from "../config/schema.ts";

export interface LoopGuardState {
	goal: string;
	toolCalls: number;
	blocked: boolean;
	lastFailureSignature?: string;
	repeatedFailures: number;
}

export interface LoopGuardOptions {
	cwd: string;
	goal?: string;
	profile?: ProjectProfile;
	maxToolCalls: number;
	maxFixIterations: number;
}

