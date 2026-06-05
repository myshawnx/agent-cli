/**
 * Cross-session project memory — read side only (C1).
 *
 * `loadMemory` reads `.agent/memory.md` (the file `agent init` scaffolds and the
 * user edits by hand); `renderMemoryForPrompt` turns it into a system-prompt block.
 * The write side (the self-hosted `remember` tool) lands in C3 — see the overview
 * §3.3, which assigns `remember` + `memory.md` writes to C3.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Read `.agent/memory.md`. Returns "" when the file is absent or unreadable. */
export function loadMemory(cwd: string): string {
	const path = join(cwd, ".agent", "memory.md");
	if (!existsSync(path)) {
		return "";
	}
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

/** Render memory as a system-prompt block. Empty input renders to "". */
export function renderMemoryForPrompt(md: string): string {
	const trimmed = md.trim();
	if (!trimmed) {
		return "";
	}
	return `# Project memory (.agent/memory.md)\n\n${trimmed}`;
}

export function appendMemory(cwd: string, note: string): string {
	const dir = join(cwd, ".agent");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "memory.md");
	const trimmed = note.trim();
	const prefix = existsSync(path) && readFileSync(path, "utf8").trim() ? "\n" : "# Project memory\n\n";
	appendFileSync(path, `${prefix}- ${trimmed}\n`, "utf8");
	return path;
}
