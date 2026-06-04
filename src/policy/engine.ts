/**
 * Pure C2 policy engine.
 *
 * This module has no IO and no pi dependency beyond the minimal tool-call shape. It
 * is the single place that decides allow/confirm/deny. The gateway translates a
 * `confirm` verdict into UI / no-UI / auto behavior.
 */

import { tier } from "./command-classifier.ts";
import { bashTouchesProtectedPath, outsideRepoRoot, pathConfirmWrite, pathDenied, targetPath } from "./path-guard.ts";
import type { ApprovalMode, ClassifyOptions, PolicyConfig, PolicyToolCall, Verdict } from "./types.ts";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);

function allow(): Verdict {
	return { kind: "allow" };
}

function confirm(reason: string): Verdict {
	return { kind: "confirm", reason };
}

function deny(reason: string): Verdict {
	return { kind: "deny", reason };
}

function bashCommand(input: unknown): string {
	if (!input || typeof input !== "object") {
		return "";
	}
	const command = (input as Record<string, unknown>).command;
	return typeof command === "string" ? command : "";
}

function readPath(event: PolicyToolCall): string | undefined {
	if (event.toolName === "find") {
		const p = targetPath(event.input);
		return p ?? ".";
	}
	return targetPath(event.input);
}

function classifyRead(event: PolicyToolCall, policy: PolicyConfig, repoRoot: string): Verdict {
	const p = readPath(event);
	if (!p) {
		return allow();
	}
	if (outsideRepoRoot(p, repoRoot)) {
		return deny(`read outside repo root: ${p}`);
	}
	if (pathDenied(p, policy.path)) {
		return deny(`protected path: ${p}`);
	}
	return allow();
}

function classifyWrite(
	event: PolicyToolCall,
	mode: ApprovalMode,
	policy: PolicyConfig,
	opts: ClassifyOptions,
): Verdict {
	if (mode === "readonly") {
		return deny(`readonly mode blocks ${event.toolName}`);
	}
	const p = targetPath(event.input);
	if (!p) {
		return confirm(`${event.toolName} target path is unknown`);
	}
	if (pathDenied(p, policy.path)) {
		return deny(`protected path: ${p}`);
	}
	if (outsideRepoRoot(p, opts.repoRoot)) {
		return confirm(`outside repo root: ${p}`);
	}
	if (pathConfirmWrite(p, policy.path)) {
		return confirm(`sensitive write target: ${p}`);
	}
	if (opts.changedFiles >= policy.limits.maxChangedFiles) {
		return confirm(`changed files limit reached (${policy.limits.maxChangedFiles})`);
	}
	if (mode === "suggest") {
		return confirm(`suggest mode requires confirmation before ${event.toolName}`);
	}
	return allow();
}

function classifyBash(command: string, mode: ApprovalMode, policy: PolicyConfig): Verdict {
	if (mode === "readonly") {
		return deny("readonly mode blocks bash");
	}
	const t = tier(command, policy.command);
	if (t === "deny") {
		return deny(`high-risk command: ${command}`);
	}
	if (bashTouchesProtectedPath(command, policy.path)) {
		return confirm(`bash touches protected path: ${command}`);
	}
	if (t === "confirm") {
		return confirm(`command requires confirmation: ${command}`);
	}
	return allow();
}

/** Decide a tool call under the given approval mode and policy. */
export function classify(
	event: PolicyToolCall,
	mode: ApprovalMode,
	policy: PolicyConfig,
	opts: ClassifyOptions,
): Verdict {
	if (READ_TOOLS.has(event.toolName)) {
		return classifyRead(event, policy, opts.repoRoot);
	}
	if (WRITE_TOOLS.has(event.toolName)) {
		return classifyWrite(event, mode, policy, opts);
	}
	if (event.toolName === "bash") {
		return classifyBash(bashCommand(event.input), mode, policy);
	}
	// C2 keeps unknown tools conservative. C6 will harden MCP/unknown defaults further.
	return confirm(`unknown tool requires confirmation: ${event.toolName}`);
}

export function isWriteLikeTool(toolName: string): boolean {
	return WRITE_TOOLS.has(toolName);
}
