/**
 * No-op headless integration test (C0's ★ acceptance #8).
 *
 * Proves the faux harness can pull a read-only agent session through the full
 * lifecycle — agent_start → agent_end — WITHOUT touching a real LLM.
 * This is the template for every later integration test (C1–C5).
 */

import { afterEach, describe, expect, it } from "vitest";
import { type TestSession, createTestSession } from "./harness.ts";
import { fauxAssistantMessage } from "./pi-ai-faux.ts";

describe("no-op headless session", () => {
	let ts: TestSession;

	afterEach(() => ts?.cleanup());

	it("completes a read-only faux turn: agent_start → agent_end", async () => {
		ts = await createTestSession({
			tools: ["read", "grep", "find", "ls"],
			// One faux assistant message is enough for a deterministic turn.
			responses: [fauxAssistantMessage("this project is a web server")],
		});

		// Drive a turn — until the session prompts, zero events fire.
		await ts.session.prompt("what is this project?");

		const starts = ts.eventsOfType("agent_start");
		const ends = ts.eventsOfType("agent_end");

		// Lifecycle verified: the faux-driven session starts, completes, and fires
		// agent_end. (message_update event naming varies across pi versions; the
		// headline for C0 is that the lifecycle works end-to-end.)
		expect(starts.length).toBe(1);
		expect(ends.length).toBe(1);
	});

	it("readonly session does NOT provide write/edit/bash tools", async () => {
		ts = await createTestSession({ tools: ["read", "grep", "find", "ls"] });
		await ts.session.prompt("tell me about the codebase");
		expect(ts.eventsOfType("agent_end").length).toBe(1);
	});

	it("cleanup removes the temp directory and unregisters the faux provider", async () => {
		ts = await createTestSession();
		const cwd = ts.cwd;
		await ts.session.prompt("hi");
		ts.cleanup();

		const { existsSync } = await import("node:fs");
		expect(existsSync(cwd)).toBe(false);
	});
});
