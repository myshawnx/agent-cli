import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AuthStorage,
	type CreateAgentSessionResult,
	type ExtensionFactory,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_POLICY_CONFIG } from "../../src/config/loader.ts";
import type { ProjectContext } from "../../src/context/types.ts";
import type { ApprovalMode, PolicyConfig } from "../../src/policy/types.ts";
import { buildResourceLoader } from "../../src/runtime/resource-loader.ts";
import { buildSession } from "../../src/runtime/session-factory.ts";
import {
	type FauxProviderRegistration,
	type FauxResponseStep,
	type RegisterFauxProviderOptions,
	fauxAssistantMessage,
	registerFauxProvider,
} from "../pi-ai-faux.ts";

export interface C1TestSession {
	cwd: string;
	agentDir: string;
	faux: FauxProviderRegistration;
	session: CreateAgentSessionResult["session"];
	resourceLoader: ReturnType<typeof buildResourceLoader>;
	events: unknown[];
	eventsOfType: (type: string) => unknown[];
	cleanup: () => void;
}

export async function createC1TestSession(opts?: {
	ctx?: Partial<ProjectContext>;
	responses?: FauxResponseStep[];
}): Promise<C1TestSession> {
	const cwd = mkdtempSync(join(tmpdir(), "agent-cli-c1-"));
	const agentDir = join(cwd, "agent-dir");
	const faux = registerFauxProvider();
	faux.setResponses(opts?.responses ?? [fauxAssistantMessage("ok")]);

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

	const ctx: ProjectContext = {
		cwd,
		mode: "readonly",
		policy: DEFAULT_POLICY_CONFIG,
		memory: "",
		...opts?.ctx,
	};
	const resourceLoader = buildResourceLoader(ctx, { agentDir });
	await resourceLoader.reload();
	const { session } = await buildSession({
		cwd,
		mode: "readonly",
		resourceLoader,
		model: faux.getModel(),
		agentDir,
		authStorage,
		sessionManager: SessionManager.inMemory(cwd),
	});
	const events: unknown[] = [];
	session.subscribe((e) => events.push(e));

	return {
		cwd,
		agentDir,
		faux,
		session,
		resourceLoader,
		events,
		eventsOfType: (type) => events.filter((e: unknown) => (e as Record<string, unknown>).type === type),
		cleanup: () => {
			session.dispose();
			faux.unregister();
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}

export interface FullTestSession {
	cwd: string;
	agentDir: string;
	faux: FauxProviderRegistration;
	session: CreateAgentSessionResult["session"];
	events: unknown[];
	eventsOfType: (type: string) => unknown[];
	/** Custom entries the extensions wrote into the pi session branch. */
	customEntries: () => Array<{ customType: string; data: Record<string, unknown> }>;
	cleanup: () => void;
}

/**
 * A full session that honors `mode` for both the tool allowlist AND the policy
 * gateway (the C1 helper hard-pins readonly), plus seams the C6 integration tests
 * need: faux provider options (usage shaping), extra extension factories (event
 * capture), and a pre-session-start hook (e.g. writing `.agent/mcp.json` before
 * `session_start` registers MCP tools).
 */
export async function createFullSession(opts?: {
	mode?: ApprovalMode;
	goal?: string;
	policy?: PolicyConfig;
	responses?: FauxResponseStep[];
	fauxOptions?: RegisterFauxProviderOptions;
	extraFactories?: ExtensionFactory[];
	/** Runs against the temp cwd before the session (and its `session_start`) is built. */
	beforeStart?: (cwd: string) => void;
}): Promise<FullTestSession> {
	const cwd = mkdtempSync(join(tmpdir(), "agent-cli-full-"));
	const agentDir = join(cwd, "agent-dir");
	opts?.beforeStart?.(cwd);

	const faux = registerFauxProvider(opts?.fauxOptions);
	faux.setResponses(opts?.responses ?? [fauxAssistantMessage("ok")]);
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

	const mode = opts?.mode ?? "workspace-write";
	const ctx: ProjectContext = {
		cwd,
		mode,
		policy: opts?.policy ?? DEFAULT_POLICY_CONFIG,
		goal: opts?.goal,
		memory: "",
	};
	const resourceLoader = buildResourceLoader(ctx, { agentDir, extraFactories: opts?.extraFactories });
	await resourceLoader.reload();
	const { session } = await buildSession({
		cwd,
		mode,
		resourceLoader,
		model: faux.getModel(),
		agentDir,
		authStorage,
		sessionManager: SessionManager.inMemory(cwd),
	});
	const events: unknown[] = [];
	session.subscribe((e) => events.push(e));
	// Mirror pi's print/interactive modes: bind extensions so `session_start` fires and
	// session-start extensions (mcpAdapter) register their tools before the first turn.
	await session.bindExtensions({});

	return {
		cwd,
		agentDir,
		faux,
		session,
		events,
		eventsOfType: (type) => events.filter((e: unknown) => (e as Record<string, unknown>).type === type),
		customEntries: () =>
			session.sessionManager
				.getBranch()
				.filter((entry: SessionEntry): entry is Extract<SessionEntry, { type: "custom" }> => entry.type === "custom")
				.map((entry) => ({ customType: entry.customType, data: (entry.data ?? {}) as Record<string, unknown> })),
		cleanup: () => {
			session.dispose();
			faux.unregister();
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}
