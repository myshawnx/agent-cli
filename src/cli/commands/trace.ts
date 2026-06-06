import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { projectTask } from "../../trace/projection.ts";
import type { TaskView } from "../../trace/types.ts";

export interface TraceOptions {
	cwd: string;
	session?: string;
}

/** Resolve a session by explicit file path, by id/path lookup, or fall back to the most recent one. */
async function resolveSessionPath(cwd: string, session: string | undefined): Promise<string | undefined> {
	if (session && existsSync(session)) {
		return session;
	}
	let sessions: Awaited<ReturnType<typeof SessionManager.list>>;
	try {
		sessions = await SessionManager.list(cwd);
	} catch (err) {
		if ((err as { code?: unknown }).code === "ENOENT") {
			sessions = [];
		} else {
			throw err;
		}
	}
	if (session) {
		return sessions.find((item) => item.id === session || item.path === session)?.path;
	}
	return [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime())[0]?.path;
}

/** Render a projected TaskView as a Markdown summary. Pure: no session/path concerns. */
export function renderTaskView(view: TaskView): string {
	const lines = [
		"# Task Trace",
		"",
		`- Goal: ${view.goal || "(none recorded)"}`,
		`- Mode: ${view.mode}`,
		`- Status: ${view.status}`,
	];
	if (view.startedAt) {
		lines.push(`- Started: ${view.startedAt}`);
	}
	if (view.endedAt) {
		lines.push(`- Ended: ${view.endedAt}`);
	}
	lines.push(`- Turns: ${view.turns}`, `- Tool calls: ${view.toolCalls}`);
	if (view.modifiedFiles.length > 0) {
		lines.push(`- Modified files (${view.modifiedFiles.length}):`);
		for (const file of view.modifiedFiles) {
			lines.push(`  - ${file}`);
		}
	} else {
		lines.push("- Modified files: none");
	}
	return lines.join("\n");
}

/**
 * Read-only CLI exit for the trace projection: resolve a session (default: most recent),
 * project its trace entries into a TaskView, and print the summary. Does not run the model.
 */
export async function runTrace(opts: TraceOptions): Promise<number> {
	const sessionPath = await resolveSessionPath(opts.cwd, opts.session);
	if (!sessionPath) {
		process.stderr.write(
			opts.session
				? `No session found for "${opts.session}". Run agent history to list sessions.\n`
				: "No pi sessions found for this cwd. Run a task first, then agent trace.\n",
		);
		return 1;
	}
	const sessionManager = SessionManager.open(sessionPath, undefined, opts.cwd);
	const view = projectTask({ sessionManager });
	process.stdout.write(`${renderTaskView(view)}\n\nSession: ${sessionPath}\n`);
	return 0;
}
