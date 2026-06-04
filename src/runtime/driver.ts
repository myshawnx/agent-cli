/**
 * Driver — the dual run path behind `agent` (interactive) and `agent -p` (print).
 *
 * Print path: the driver manages its own `session.subscribe` + `session.prompt`
 * loop (semantically aligned with pi's print "text" mode — stream `text_delta`s to
 * stdout). It deliberately does NOT call pi's `runPrintMode`, because that takes an
 * `AgentSessionRuntime` host (built via `createAgentSessionRuntime`), not a bare
 * session. Keeping our own loop means C1 only needs a session.
 *
 * Interactive path: hands the cwd over to pi's TUI runtime — building the
 * `AgentSessionRuntime` host pi's `InteractiveMode` expects, then `.run()`.
 *
 * `onUsage` is a usage-event seam reserved for C3 token soft-stop / C6 budget; it is
 * supplied but not consumed in C1 (overview §3.1).
 */

import type { Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AuthStorage,
	InteractiveMode,
	SessionManager,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ProjectContext } from "../context/types.ts";
import type { AnyModel } from "./model.ts";
import { buildInjectedSystemPrompt } from "./resource-loader.ts";
import { computeTools } from "./session-factory.ts";

export type TokenUsage = Usage;

export interface DriveOptions {
	printMode: boolean;
	prompt: string;
	/** Usage callback seam (C3 token soft-stop / C6 budget). Not consumed in C1. */
	onUsage?: (u: TokenUsage) => void;
}

/**
 * Drive a session. C1 supports the PRINT path on a bare session: stream assistant
 * text to stdout, await the turn, then dispose. The interactive path needs an
 * `AgentSessionRuntime` host (not a bare session), so it lives in `driveInteractive`.
 */
export async function drive(session: AgentSession, opts: DriveOptions): Promise<void> {
	if (!opts.printMode) {
		throw new Error("interactive mode requires driveInteractive() (needs an AgentSessionRuntime host)");
	}
	let wroteTextDelta = false;
	let reportedUsage = false;
	const unsubscribe = session.subscribe((e) => {
		if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
			wroteTextDelta = true;
			process.stdout.write(e.assistantMessageEvent.delta);
		}
		if (e.type === "agent_end" && opts.onUsage) {
			const last = e.messages[e.messages.length - 1];
			if (last?.role === "assistant") {
				reportedUsage = true;
				opts.onUsage(last.usage);
			}
		}
	});
	try {
		await session.prompt(opts.prompt);
		if (!wroteTextDelta) {
			const finalText = session.getLastAssistantText();
			if (finalText) {
				process.stdout.write(finalText);
			}
		}
		if (!reportedUsage && opts.onUsage) {
			const last = session.messages[session.messages.length - 1];
			if (last?.role === "assistant") {
				opts.onUsage(last.usage);
			}
		}
		// Terminate the streamed line so the shell prompt starts cleanly.
		process.stdout.write("\n");
	} finally {
		unsubscribe();
		session.dispose();
	}
}

export interface DriveInteractiveOptions {
	ctx: ProjectContext;
	prompt?: string;
	model?: AnyModel;
	modelId?: string;
	agentDir: string;
	authStorage?: AuthStorage;
	modelFallbackMessage?: string;
}

/**
 * Drive the INTERACTIVE path: build the `AgentSessionRuntime` host pi's TUI needs
 * (services → session → runtime), mirroring pi's own `main.ts` wiring, then run.
 *
 * Profile + memory are injected via the same `buildInjectedSystemPrompt(ctx)` source
 * as the print path, so both paths show the agent identical context.
 */
export async function driveInteractive(opts: DriveInteractiveOptions): Promise<void> {
	const { ctx, agentDir } = opts;
	const injected = buildInjectedSystemPrompt(ctx);
	const sessionManager = SessionManager.create(ctx.cwd);

	const createRuntime = async ({
		cwd,
		agentDir: runtimeAgentDir,
		sessionManager: sm,
		sessionStartEvent,
	}: {
		cwd: string;
		agentDir: string;
		sessionManager: SessionManager;
		sessionStartEvent?: Parameters<typeof createAgentSessionFromServices>[0]["sessionStartEvent"];
	}) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir: runtimeAgentDir,
			authStorage: opts.authStorage,
			resourceLoaderOptions: {
				appendSystemPromptOverride: (base: string[]) => [...base, ...injected],
			},
		});
		const result = await createAgentSessionFromServices({
			services,
			sessionManager: sm,
			sessionStartEvent,
			model: opts.model,
			tools: computeTools(ctx.mode),
		});
		return { ...result, services, diagnostics: services.diagnostics };
	};

	initTheme(undefined, true);
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: ctx.cwd,
		agentDir,
		sessionManager,
	});
	const interactive = new InteractiveMode(runtime, {
		modelFallbackMessage: opts.modelFallbackMessage ?? runtime.modelFallbackMessage,
		initialMessage: opts.prompt,
	});
	await interactive.run();
}
