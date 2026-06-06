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
import { buildExtensionFactories, buildInjectedSystemPrompt } from "./resource-loader.ts";
import { computeTools } from "./session-factory.ts";

export type TokenUsage = Usage;

export interface DriveOptions {
	printMode: boolean;
	prompt: string;
	/** Usage callback seam (C3 token soft-stop / C6 budget). Not consumed in C1. */
	onUsage?: (u: TokenUsage) => void;
}

function modifiedFilesFromSession(session: AgentSession): string[] {
	const entries = session.sessionManager.getBranch();
	const files = entries
		.filter((entry): entry is Extract<(typeof entries)[number], { type: "custom" }> => {
			return entry.type === "custom" && entry.customType === "task-modified-file";
		})
		.map((entry) => (entry.data as { path?: unknown } | undefined)?.path)
		.filter((path): path is string => typeof path === "string" && path.length > 0);
	return [...new Set(files)];
}

function appendFailureHandoff(
	session: AgentSession,
	reason: string,
	stats: { turns: number; toolCalls: number; signal?: NodeJS.Signals },
): void {
	const endedAt = new Date().toISOString();
	const modifiedFiles = modifiedFilesFromSession(session);
	session.sessionManager.appendCustomEntry("abort-preserved", {
		reason,
		signal: stats.signal,
		endedAt,
		preserveDiff: true,
		modifiedFiles,
	});
	session.sessionManager.appendCustomEntry("task-result", {
		status: "failed",
		endedAt,
		turns: stats.turns,
		toolCalls: stats.toolCalls,
		modifiedFiles,
	});
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
	let turns = 0;
	let toolCalls = 0;
	let failureRecorded = false;
	let rejectSignal: ((err: Error) => void) | undefined;
	const signalPromise = new Promise<never>((_resolve, reject) => {
		rejectSignal = reject;
	});
	const onSignal = (signal: NodeJS.Signals) => {
		if (!failureRecorded) {
			failureRecorded = true;
			appendFailureHandoff(session, `${signal} received; current diff preserved for handoff`, {
				turns,
				toolCalls,
				signal,
			});
		}
		session.dispose();
		rejectSignal?.(new Error(`${signal} received; current diff preserved for handoff`));
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	const unsubscribe = session.subscribe((e) => {
		if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
			wroteTextDelta = true;
			process.stdout.write(e.assistantMessageEvent.delta);
		}
		if (e.type === "turn_end") {
			turns++;
		}
		if (e.type === "tool_execution_start") {
			toolCalls++;
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
		// Fire `session_start` so session-start extensions (notably mcpAdapter, which
		// registers `mcp__*` tools) activate on the print path too. pi's own print /
		// interactive modes do this via bindExtensions; our bare-session driver must do
		// it explicitly or MCP tools would only ever exist in interactive mode.
		await session.bindExtensions({});
		await Promise.race([session.prompt(opts.prompt), signalPromise]);
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
	} catch (err) {
		if (!failureRecorded) {
			failureRecorded = true;
			const reason = err instanceof Error ? err.message : String(err);
			appendFailureHandoff(session, reason, { turns, toolCalls });
		}
		throw err;
	} finally {
		process.removeListener("SIGINT", onSignal);
		process.removeListener("SIGTERM", onSignal);
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
	sessionManager?: SessionManager;
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
	const sessionManager = opts.sessionManager ?? SessionManager.create(ctx.cwd);

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
				extensionFactories: buildExtensionFactories(ctx),
				appendSystemPromptOverride: (base: string[]) => [...base, ...injected],
			},
		});
		const toolOptions = ctx.mode === "readonly" ? { tools: computeTools(ctx.mode) } : { noTools: "builtin" as const };
		const result = await createAgentSessionFromServices({
			services,
			sessionManager: sm,
			sessionStartEvent,
			model: opts.model,
			...toolOptions,
		});
		const activeToolNames =
			ctx.mode === "readonly"
				? computeTools(ctx.mode)
				: [...new Set([...computeTools(ctx.mode), ...result.session.getActiveToolNames()])];
		result.session.setActiveToolsByName(activeToolNames);
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
