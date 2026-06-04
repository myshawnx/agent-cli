/**
 * Session factory — `computeTools` + `buildSession`.
 *
 * `computeTools` is C1's *security primitive*: the readonly tool allowlist is a
 * physical boundary, not a prompt instruction. pi only activates tools whose names
 * are in the list (verified against pi's `createReadOnlyTools`, which is exactly
 * `[read, grep, find, ls]`), so a model that emits `write`/`bash` in readonly mode
 * simply has no such tool to call. This is the first brick of C2's safety argument.
 *
 * `buildSession` wraps pi's `createAgentSession`, pinning the pi `SessionManager` as
 * the single source of truth and enabling provider retry. It returns pi's full
 * `CreateAgentSessionResult` (`{ session, extensionsResult, modelFallbackMessage }`)
 * — callers destructure `session` before driving, and surface `modelFallbackMessage`
 * for the no-model/no-key friendly error.
 */

import { getModel } from "@earendil-works/pi-ai";
import {
	type AuthStorage,
	type CreateAgentSessionResult,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ApprovalMode } from "../policy/types.ts";
import type { AnyModel } from "./model.ts";

/** Default model when none is injected/configured. Valid `getModel("anthropic", …)` id. */
export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

/** Built-in readonly tools — kept identical to pi's `createReadOnlyTools`. */
const READONLY_TOOLS = ["read", "grep", "find", "ls"] as const;

/**
 * The tool allowlist for a mode. readonly is hard-isolated to read/grep/find/ls;
 * the write/edit/bash tools are only handed out in C2's modes — but the *gating* of
 * those tools is C2's policy engine, not this function.
 */
export function computeTools(mode: ApprovalMode): string[] {
	const base = [...READONLY_TOOLS];
	if (mode === "readonly") {
		return base;
	}
	return [...base, "edit", "write", "bash"];
}

export interface BuildSessionOptions {
	cwd: string;
	mode: ApprovalMode;
	resourceLoader: ResourceLoader;
	/** Model id passed to `getModel("anthropic", …)`. Ignored if `model` is set. */
	modelId?: string;
	/** Pre-built model object (faux tests inject `faux.getModel()`; takes priority over `modelId`). */
	model?: AnyModel;
	/** Global config dir (tests pass a temp dir). */
	agentDir?: string;
	/** Auth storage (faux tests inject an in-memory store with a placeholder key). */
	authStorage?: AuthStorage;
	/** Session manager injection for tests; production defaults to pi's persisted manager. */
	sessionManager?: SessionManager;
}

/**
 * Resolve the model for a session: an injected `model` wins; otherwise look up
 * `anthropic` + `modelId` (defaulting to {@link DEFAULT_MODEL_ID}).
 *
 * `getModel` is statically typed to the known model-id literal union. A CLI `--model`
 * is a runtime string, so for that path we widen the call signature; an unknown id
 * surfaces pi's own resolution error rather than a TS error here. The default path
 * stays fully type-checked.
 */
export function resolveModel(opts: { model?: AnyModel; modelId?: string }): AnyModel {
	if (opts.model) {
		return opts.model;
	}
	if (!opts.modelId) {
		return getModel("anthropic", DEFAULT_MODEL_ID);
	}
	const lookup = getModel as unknown as (provider: string, modelId: string) => AnyModel;
	return lookup("anthropic", opts.modelId);
}

/**
 * Build a pi agent session with the C1 wiring. Returns pi's full result so the
 * caller can read `modelFallbackMessage` for friendly no-model errors.
 */
export function buildSession(opts: BuildSessionOptions): Promise<CreateAgentSessionResult> {
	const model = resolveModel({ model: opts.model, modelId: opts.modelId });
	return createAgentSession({
		cwd: opts.cwd,
		agentDir: opts.agentDir,
		model,
		tools: computeTools(opts.mode), // ★ allowlist = the only readonly boundary
		resourceLoader: opts.resourceLoader,
		sessionManager: opts.sessionManager ?? SessionManager.create(opts.cwd), // pi session = single source of truth
		settingsManager: SettingsManager.inMemory({
			retry: { enabled: true, maxRetries: 2 }, // delegate rate-limit / 5xx to pi
		}),
		authStorage: opts.authStorage,
	});
}
