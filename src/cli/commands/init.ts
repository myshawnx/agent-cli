/**
 * `agent init` — detect the project profile and scaffold `.agent/`.
 *
 * Writes three files: `project-profile.json` (detected), a `memory.md` skeleton, and
 * an empty `policy.json` placeholder (fields unexplained — C2 owns them). Idempotent:
 * existing files are preserved unless `--force` is passed. NOTE: `init` does NOT emit
 * `.agent/mcp.json` — that is produced by C5's `agent mcp add` at runtime
 * (overview §3.5).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY_CONFIG } from "../../config/loader.ts";
import { writeMemory, writePolicy } from "../../config/writer.ts";
import { detectProfile, renderProfileForPrompt, saveProfile } from "../../context/profile.ts";
import { createLogger } from "../../util/logger.ts";

const log = createLogger("init");

const MEMORY_SKELETON = `# Project memory

This file is loaded into the agent's context every run. Add durable, cross-session
facts the agent should always know about this project — conventions, gotchas, where
things live. Keep it short.

Known limitation: profile detection covers single-repo TS/JS, Python, and Go. For
monorepos / workspaces, record the per-package commands here by hand.

<!-- Example:
- Run a single test: \`npm test -- <file>\`
- The HTTP entrypoint is src/server.ts
-->
`;

export interface InitOptions {
	cwd: string;
	force?: boolean;
}

export async function runInit(opts: InitOptions): Promise<number> {
	const { cwd } = opts;
	const dir = join(cwd, ".agent");
	const profilePath = join(dir, "project-profile.json");
	const memoryPath = join(dir, "memory.md");
	const policyPath = join(dir, "policy.json");

	const exists = existsSync(profilePath) || existsSync(memoryPath) || existsSync(policyPath);
	if (exists && !opts.force) {
		log.warn(".agent/ already exists; re-run with --force to overwrite", { dir });
		return 0;
	}

	const profile = await detectProfile(cwd);
	const profileErrors = saveProfile(cwd, profile);
	if (profileErrors.length > 0) {
		log.error("failed to write project-profile.json", { errors: profileErrors });
		return 1;
	}

	// Only scaffold memory/policy when absent (or forced) — never clobber user edits.
	if (!existsSync(memoryPath) || opts.force) {
		writeMemory(cwd, MEMORY_SKELETON);
	}
	if (!existsSync(policyPath) || opts.force) {
		const policyErrors = writePolicy(cwd, DEFAULT_POLICY_CONFIG);
		if (policyErrors.length > 0) {
			log.error("failed to write policy.json", { errors: policyErrors });
			return 1;
		}
	}

	// Human-facing summary on stdout (the detected picture).
	process.stdout.write(
		`${renderProfileForPrompt(profile)}\n\nWrote .agent/ (project-profile.json, memory.md, policy.json)\n`,
	);
	return 0;
}
