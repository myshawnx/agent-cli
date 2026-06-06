export interface TaskMetaEntry {
	goal: string;
	mode: string;
	startedAt: string;
}

export interface TaskResultEntry {
	status: "completed" | "failed";
	endedAt: string;
	turns: number;
	toolCalls: number;
	modifiedFiles: string[];
}

export interface TaskView {
	goal: string;
	mode: string;
	status: "running" | "completed" | "failed" | "unknown";
	startedAt?: string;
	endedAt?: string;
	turns: number;
	toolCalls: number;
	modifiedFiles: string[];
	result?: TaskResultEntry;
}
