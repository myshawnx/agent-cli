/**
 * Headless faux-provider test harness (C0's most important deliverable).
 *
 * Built directly against pi 0.78's real API, verified in pi's own test suite:
 * - `registerFauxProvider()` → returns { getModel, setResponses, unregister }
 * - `fauxAssistantMessage(...)` wraps content blocks into a FauxResponseStep
 * - `session.prompt(...)` drives a turn (required; subscribe alone fires nothing)
 *
 * Every later cycle's integration tests (C1–C5) template off this harness. It MUST
 * stay green without any real LLM calls or provider keys.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type FauxProviderRegistration,
	type FauxResponseStep,
	fauxAssistantMessage,
	registerFauxProvider,
} from "@earendil-works/pi-ai";
import {
	AuthStorage,
	type CreateAgentSessionResult,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";

export interface TestSession {
	session: CreateAgentSessionResult["session"];
	faux: FauxProviderRegistration;
	/** Replace the scripted response queue entirely. */
	setResponses: (steps: FauxResponseStep[]) => void;
	/** Append one or more responses to the tail of the queue. */
	appendResponses: (steps: FauxResponseStep[]) => void;
	/** All events emitted since the last `subscribe` call. */
	events: unknown[];
	/** Events matching a specific `type` field. */
	eventsOfType: (type: string) => unknown[];
	/** Absolute path of the temporary directory. */
	cwd: string;
	/** Dispose the session, unregister the faux provider, and delete the temp dir. */
	cleanup: () => void;
}

export async function createTestSession(opts?: {
	tools?: string[];
	responses?: FauxResponseStep[];
}): Promise<TestSession> {
	// Isolated temp directory per test; cleaned up on cleanup()
	const cwd = mkdtempSync(join(tmpdir(), "agent-cli-test-"));
	const agentDir = join(cwd, "agent");

	// Register a faux provider (offline, deterministic, no real LLM)
	const faux = registerFauxProvider();
	faux.setResponses(opts?.responses ?? [fauxAssistantMessage("ok")]);

	// Auth: faux providers need a stored key; the value is irrelevant
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

	// In-memory managers — no disk writes and no leftover state between tests
	const sessionManager = SessionManager.inMemory(cwd);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
	});

	// Hard tool isolation: allowlist is the real mechanism (verified in pi regression tests
	// #2835, #5109, #3592). Tools not in the list simply don't exist for the agent.
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		tools: opts?.tools ?? ["read", "grep", "find", "ls"],
		sessionManager,
		settingsManager,
		authStorage,
		resourceLoader,
	});

	// Subscribe for event capture (no turn driven yet — caller calls session.prompt())
	const events: unknown[] = [];
	session.subscribe((e) => events.push(e));

	function cleanup(): void {
		session.dispose();
		faux.unregister();
		rmSync(cwd, { recursive: true, force: true });
	}

	return {
		session,
		faux,
		setResponses: (steps) => faux.setResponses(steps),
		appendResponses: (steps) => faux.appendResponses(steps),
		events,
		eventsOfType: (type) => events.filter((e: unknown) => (e as Record<string, unknown>).type === type),
		cwd,
		cleanup,
	};
}
