/**
 * Resource loader factory — the extension-factory pipeline + system-prompt injection.
 *
 * This is one of C1's three load-bearing seams. The `extensionFactories` array is
 * empty in C1 (a documented placeholder): C2's `policyGateway`, C3's `trace`/`guards`,
 * and C5's `mcpAdapter` all get appended here via `opts.extraFactories`, so the outer
 * shell never changes again. AGENTS.md is loaded by pi natively; profile + memory are
 * *context* we append to the system prompt via `appendSystemPromptOverride` (which
 * appends to, rather than replaces, pi's base entries).
 *
 * Callers must `await loader.reload()` before using the loader (pi requirement).
 */

import { DefaultResourceLoader, type ExtensionFactory, getAgentDir } from "@earendil-works/pi-coding-agent";
import { renderMemoryForPrompt } from "../context/memory.ts";
import { renderProfileForPrompt } from "../context/profile.ts";
import type { ProjectContext } from "../context/types.ts";

export interface BuildResourceLoaderOptions {
	/** ★ Extension factories appended to the (empty in C1) pipeline. C2/C3/C5 inject here. */
	extraFactories?: ExtensionFactory[];
	/** Global config dir. Defaults to pi's `getAgentDir()`; tests pass a temp dir. */
	agentDir?: string;
}

/**
 * The profile + memory text appended to the system prompt, in order.
 * Exported so the interactive path (which builds its resource loader via pi's
 * `createAgentSessionServices`) injects from the exact same source.
 */
export function buildInjectedSystemPrompt(ctx: ProjectContext): string[] {
	return [
		ctx.profile ? renderProfileForPrompt(ctx.profile) : "",
		ctx.memory ? renderMemoryForPrompt(ctx.memory) : "",
	].filter(Boolean);
}

export function buildResourceLoader(ctx: ProjectContext, opts?: BuildResourceLoaderOptions): DefaultResourceLoader {
	const factories: ExtensionFactory[] = [...(opts?.extraFactories ?? [])];
	const injected = buildInjectedSystemPrompt(ctx);
	return new DefaultResourceLoader({
		cwd: ctx.cwd,
		agentDir: opts?.agentDir ?? getAgentDir(),
		extensionFactories: factories,
		// Append (do not replace) so pi's own base system-prompt entries survive.
		appendSystemPromptOverride: (base: string[]) => [...base, ...injected],
	});
	// Caller is responsible for `await loader.reload()`.
}
