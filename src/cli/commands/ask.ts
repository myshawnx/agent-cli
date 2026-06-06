/**
 * `agent ask` / the default `agent "<task>"` run.
 *
 * Builds a ProjectContext (profile + memory + policy), wires the resource loader and
 * session, then drives either the print loop (`-p`) or the interactive TUI. C2 adds
 * policy-gateway enforcement for suggest/workspace-write/auto; readonly remains
 * physically hard-isolated to read/grep/find/ls via `computeTools("readonly")`.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadAgentConfig } from "../../config/loader.ts";
import { loadMemory } from "../../context/memory.ts";
import { detectProfile, loadProfile } from "../../context/profile.ts";
import type { ProjectContext } from "../../context/types.ts";
import type { ApprovalMode } from "../../policy/types.ts";
import { drive, driveInteractive } from "../../runtime/driver.ts";
import { buildResourceLoader } from "../../runtime/resource-loader.ts";
import { buildSession } from "../../runtime/session-factory.ts";
import { createLogger } from "../../util/logger.ts";

const log = createLogger("ask");

export interface AskOptions {
	cwd: string;
	prompt: string;
	printMode: boolean;
	mode: ApprovalMode;
	modelId?: string;
}

async function buildContext(cwd: string, mode: ApprovalMode): Promise<ProjectContext> {
	const config = loadAgentConfig(cwd);
	for (const diagnostic of config.diagnostics) {
		const fields = { file: diagnostic.file };
		if (diagnostic.level === "error") {
			log.error(diagnostic.message, fields);
		} else {
			log.warn(diagnostic.message, fields);
		}
	}
	const profile = loadProfile(cwd) ?? config.profile ?? (await detectProfile(cwd));
	return { cwd, mode, policy: config.policy, profile, memory: loadMemory(cwd) || config.memory };
}

export async function runAsk(opts: AskOptions): Promise<number> {
	const ctx = { ...(await buildContext(opts.cwd, opts.mode)), goal: opts.prompt };
	if (ctx.policy.sandbox.enabled) {
		log.warn("policy.sandbox.enabled=true is configured, but OS-level sandbox wiring is not implemented in v1.0.");
	}

	// Interactive TUI: hand off to pi's runtime (it owns model/auth/login UI).
	if (!opts.printMode) {
		await driveInteractive({ ctx, prompt: opts.prompt, modelId: opts.modelId, agentDir: getAgentDir() });
		return 0;
	}

	// Print mode: build a bare session and stream the answer to stdout.
	const resourceLoader = buildResourceLoader(ctx);
	await resourceLoader.reload();
	const { session, modelFallbackMessage } = await buildSession({
		cwd: opts.cwd,
		mode: opts.mode,
		resourceLoader,
		modelId: opts.modelId,
	});
	if (modelFallbackMessage) {
		log.warn(modelFallbackMessage);
	}

	try {
		await drive(session, { printMode: true, prompt: opts.prompt });
		return 0;
	} catch (err) {
		// No model / no API key surfaces here (pi throws on prompt). Keep it readable.
		const message = err instanceof Error ? err.message : String(err);
		log.error(message);
		process.stderr.write(
			`\nCould not complete the request: ${message}\nSet ANTHROPIC_API_KEY (or pass --model for a configured provider) and retry.\n`,
		);
		return 1;
	}
}
