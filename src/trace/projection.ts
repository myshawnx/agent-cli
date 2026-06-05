import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { TaskMetaEntry, TaskResultEntry, TaskView } from "./types.ts";

type ReadonlySessionManagerLike = Pick<SessionManager, "getBranch">;

function customEntries(entries: SessionEntry[], customType: string): Array<Extract<SessionEntry, { type: "custom" }>> {
	return entries.filter((entry): entry is Extract<SessionEntry, { type: "custom" }> => {
		return entry.type === "custom" && entry.customType === customType;
	});
}

export function projectTaskFromEntries(entries: SessionEntry[]): TaskView {
	const meta = customEntries(entries, "task-meta").at(-1)?.data as TaskMetaEntry | undefined;
	const result = customEntries(entries, "task-result").at(-1)?.data as TaskResultEntry | undefined;
	const toolCalls = customEntries(entries, "task-tool-call").length;
	const modifiedFiles = customEntries(entries, "task-modified-file")
		.map((entry) => (entry.data as { path?: string } | undefined)?.path)
		.filter((path): path is string => typeof path === "string" && path.length > 0);

	return {
		goal: meta?.goal ?? "",
		mode: meta?.mode ?? "unknown",
		status: result?.status ?? (meta ? "running" : "unknown"),
		startedAt: meta?.startedAt,
		endedAt: result?.endedAt,
		turns: result?.turns ?? 0,
		toolCalls: result?.toolCalls ?? toolCalls,
		modifiedFiles: result?.modifiedFiles ?? [...new Set(modifiedFiles)],
		result,
	};
}

export function projectTask(ctx: { sessionManager: ReadonlySessionManagerLike }): TaskView {
	return projectTaskFromEntries(ctx.sessionManager.getBranch());
}
