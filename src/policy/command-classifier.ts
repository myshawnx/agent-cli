/**
 * Bash command risk tiering.
 *
 * This classifier is intentionally string-level. It is a policy speed bump, not a
 * shell parser and not an OS security boundary. Matching is conservative: deny wins
 * over confirm, confirm wins over allow, and unknown commands require confirmation.
 */

import type { PolicyConfig } from "./types.ts";

export type Tier = "allow" | "confirm" | "deny";

const BUILTIN_DENY_PATTERNS = [
	"rm -rf",
	"rm -fr",
	"sudo",
	"curl | sh",
	"curl|sh",
	"curl | bash",
	"curl|bash",
	"wget | sh",
	"wget|sh",
	"wget | bash",
	"wget|bash",
	"chmod -R",
	"chmod -r",
	"chown -R",
	"chown -r",
	"dd ",
	"mkfs",
	":(){",
];

function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ");
}

function normalizeForPipe(command: string): string {
	return normalizeCommand(command).replace(/\s*\|\s*/g, "|");
}

function normalizedPattern(pattern: string): string {
	return normalizeCommand(pattern).toLowerCase();
}

function matchesPattern(command: string, pattern: string): boolean {
	const normalized = normalizeCommand(command).toLowerCase();
	const p = normalizedPattern(pattern);

	// Pipeline patterns: split and match each segment (prefix on first, suffix/contains on last).
	if (p.includes("|")) {
		const cmdParts = normalizeForPipe(command)
			.toLowerCase()
			.split("|")
			.map((s) => s.trim());
		const patParts = p
			.replace(/\s*\|\s*/g, "|")
			.split("|")
			.map((s) => s.trim());
		if (cmdParts.length < patParts.length) return false;
		return patParts.every((pp, i) => {
			const cmdPart = cmdParts[i] ?? "";
			if (i === 0) return cmdPart.startsWith(pp);
			return cmdPart.includes(pp);
		});
	}

	return normalized === p || normalized.startsWith(`${p} `) || normalized.includes(p);
}

function matchesAny(command: string, patterns: string[]): boolean {
	return patterns.some((p) => p.trim() !== "" && matchesPattern(command, p));
}

/** deny > confirm > allow; unknown commands require confirmation. */
export function tier(command: string, cfg: PolicyConfig["command"]): Tier {
	const normalized = normalizeCommand(command);
	if (!normalized) {
		return "confirm";
	}
	if (matchesAny(normalized, [...BUILTIN_DENY_PATTERNS, ...cfg.deny])) {
		return "deny";
	}
	if (matchesAny(normalized, cfg.confirm)) {
		return "confirm";
	}
	if (matchesAny(normalized, cfg.allow)) {
		return "allow";
	}
	return "confirm";
}

export const normalizeCommandForPolicy = normalizeCommand;
