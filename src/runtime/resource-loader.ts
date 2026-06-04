/**
 * Resource loader factory — the extension-factory pipeline + system-prompt injection.
 *
 * This is one of C1/C2's load-bearing seams. C2 installs `policyGateway` as the
 * first extension factory so policy decisions happen before later loop/trace/MCP
 * layers. C3/C5 append their factories via `opts.extraFactories`, keeping the outer
 * shell stable. AGENTS.md is loaded by pi natively; profile + memory are context we
 * append to the system prompt via `appendSystemPromptOverride`.
 *
 * Callers must `await loader.reload()` before using the loader (pi requirement).
 */

import { DefaultResourceLoader, type ExtensionFactory, getAgentDir } from "@earendil-works/pi-coding-agent";
import { renderMemoryForPrompt } from "../context/memory.ts";
import { renderProfileForPrompt } from "../context/profile.ts";
import type { ProjectContext } from "../context/types.ts";
import { policyGateway } from "../policy/gateway.ts";

export interface BuildResourceLoaderOptions {
	/** Extension factories appended after policyGateway. C3/C5 inject here. */
	extraFactories?: ExtensionFactory[];
	/** Global config dir. Defaults to pi's `getAgentDir()`; tests pass a temp dir. */
	agentDir?: string;
}

/**
 * The profile + memory text appended to the system prompt, in order.
 * Exported so the interactive path injects from the exact same source.
 */
export function buildInjectedSystemPrompt(ctx: ProjectContext): string[] {
	return [
		ctx.profile ? renderProfileForPrompt(ctx.profile) : "",
		ctx.memory ? renderMemoryForPrompt(ctx.memory) : "",
	].filter(Boolean);
}

/** Extension registration order is fixed by overview §3.4: policy first. */
export function buildExtensionFactories(ctx: ProjectContext, extraFactories?: ExtensionFactory[]): ExtensionFactory[] {
	return [policyGateway(ctx.policy, ctx.mode, ctx.cwd), ...(extraFactories ?? [])];
}

export function buildResourceLoader(ctx: ProjectContext, opts?: BuildResourceLoaderOptions): DefaultResourceLoader {
	const injected = buildInjectedSystemPrompt(ctx);
	return new DefaultResourceLoader({
		cwd: ctx.cwd,
		agentDir: opts?.agentDir ?? getAgentDir(),
		extensionFactories: buildExtensionFactories(ctx, opts?.extraFactories),
		// Append (do not replace) so pi's own base system-prompt entries survive.
		appendSystemPromptOverride: (base: string[]) => [...base, ...injected],
	});
	// Caller is responsible for `await loader.reload()`.
}
