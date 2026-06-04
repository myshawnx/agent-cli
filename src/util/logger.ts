/**
 * Minimal structured logger reused by every later module.
 *
 * - Levels: debug < info < warn < error, filtered by `AGENT_LOG_LEVEL` (default "info").
 * - Two output shapes: "pretty" (default, human-readable on stderr) and "json"
 *   (one JSON object per line), selected by `AGENT_LOG_FORMAT`.
 *
 * Logs go to stderr so they never corrupt stdout, which `-p` / print mode uses
 * for the agent's actual answer.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function envLevel(): LogLevel {
	const raw = (process.env.AGENT_LOG_LEVEL ?? "info").toLowerCase();
	if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
		return raw;
	}
	return "info";
}

function envFormat(): "pretty" | "json" {
	return (process.env.AGENT_LOG_FORMAT ?? "pretty").toLowerCase() === "json" ? "json" : "pretty";
}

export interface Logger {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
}

function emit(scope: string, level: LogLevel, message: string, fields?: Record<string, unknown>): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[envLevel()]) {
		return;
	}
	if (envFormat() === "json") {
		process.stderr.write(`${JSON.stringify({ level, scope, message, ...fields })}\n`);
		return;
	}
	const prefix = `[${level}] ${scope ? `${scope}: ` : ""}`;
	const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
	process.stderr.write(`${prefix}${message}${suffix}\n`);
}

export function createLogger(scope = ""): Logger {
	return {
		debug: (message, fields) => emit(scope, "debug", message, fields),
		info: (message, fields) => emit(scope, "info", message, fields),
		warn: (message, fields) => emit(scope, "warn", message, fields),
		error: (message, fields) => emit(scope, "error", message, fields),
	};
}
