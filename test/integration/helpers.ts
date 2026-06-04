import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type FauxProviderRegistration,
	type FauxResponseStep,
	fauxAssistantMessage,
	registerFauxProvider,
} from "@earendil-works/pi-ai";
import { AuthStorage, type CreateAgentSessionResult, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ProjectContext } from "../../src/context/types.ts";
import { buildResourceLoader } from "../../src/runtime/resource-loader.ts";
import { buildSession } from "../../src/runtime/session-factory.ts";

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
