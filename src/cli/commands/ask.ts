/**
 * `agent ask` / the default `agent "<task>"` run — read-only Q&A.
 *
 * Builds a readonly ProjectContext (profile + memory), wires the resource loader and
 * session, then drives either the print loop (`-p`) or the interactive TUI. The
 * session is hard-isolated to read/grep/find/ls via `computeTools("readonly")`, so
 * the agent can understand and answer but never write or execute.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadMemory } from "../../context/memory.ts";
import { detectProfile, loadProfile } from "../../context/profile.ts";
import type { ProjectContext } from "../../context/types.ts";
import { drive, driveInteractive } from "../../runtime/driver.ts";
import { buildResourceLoader } from "../../runtime/resource-loader.ts";
import { buildSession } from "../../runtime/session-factory.ts";
import { createLogger } from "../../util/logger.ts";

const log = createLogger("ask");

export interface AskOptions {
	cwd: string;
	prompt: string;
	printMode: boolean;
	modelId?: string;
}

async function buildContext(cwd: string): Promise<ProjectContext> {
	const profile = loadProfile(cwd) ?? (await detectProfile(cwd));
	return { cwd, mode: "readonly", profile, memory: loadMemory(cwd) };
}

export async function runAsk(opts: AskOptions): Promise<number> {
	const ctx = await buildContext(opts.cwd);

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
		mode: "readonly",
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
