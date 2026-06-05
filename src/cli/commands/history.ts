import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

export interface HistoryOptions {
	cwd: string;
}

function summarize(session: SessionInfo): string {
	const label = session.name || session.firstMessage || "(empty session)";
	return label.replace(/\s+/g, " ").trim().slice(0, 90);
}

export async function runHistory(opts: HistoryOptions): Promise<number> {
	const sessions = await SessionManager.list(opts.cwd);
	if (sessions.length === 0) {
		process.stdout.write("No pi sessions found for this cwd.\n");
		return 0;
	}
	const lines = ["# Agent History", ""];
	for (const session of sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime())) {
		lines.push(
			`- ${session.id}  ${session.modified.toISOString()}  messages=${session.messageCount}  ${summarize(session)}`,
			`  path: ${session.path}`,
		);
	}
	process.stdout.write(`${lines.join("\n")}\n`);
	return 0;
}

