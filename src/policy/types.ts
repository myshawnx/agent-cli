/**
 * C2 policy types.
 *
 * ApprovalMode and PolicyConfig are re-exported from the C0 config schema so the
 * runtime type and on-disk `.agent/policy.json` schema stay in lock-step. C2 adds
 * the Verdict union and the small tool-call shape consumed by the pure engine.
 */

import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { ApprovalMode, PolicyConfig } from "../config/schema.ts";

export type { ApprovalMode, PolicyConfig };

export type Verdict = { kind: "allow" } | { kind: "confirm"; reason: string } | { kind: "deny"; reason: string };

/** Minimal shape accepted by the pure policy engine and tests. */
export type PolicyToolCall = Pick<ToolCallEvent, "toolName" | "input">;

export interface ClassifyOptions {
	/** Absolute or relative project root used for cwd-bound path checks. */
	repoRoot: string;
	/** Number of changed files already allowed in this agent run. */
	changedFiles: number;
}

export const DEFAULT_POLICY_DENY_PATTERNS = ["rm -rf", "sudo", "curl | sh", "wget | sh", "chmod -R", "dd", "mkfs"];
export const DEFAULT_POLICY_CONFIRM_PATTERNS = [
	"git push",
	"git commit",
	"npm install",
	"pnpm add",
	"docker compose up",
];
export const DEFAULT_POLICY_ALLOW_PATTERNS = [
	"npm test",
	"npm run lint",
	"npm run build",
	"pnpm test",
	"pnpm run lint",
	"pnpm run build",
	"pytest",
	"go test",
];

export const DEFAULT_PATH_DENY_PATTERNS = [".git/**", ".env", "**/*.pem", "~/.ssh/**", "**/credentials*"];
export const DEFAULT_PATH_CONFIRM_WRITE_PATTERNS = ["package.json", "**/*lock*", ".github/**", "tsconfig*.json"];
