import { existsSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { type C1TestSession, createC1TestSession } from "./helpers.ts";

describe("C1 readonly session", () => {
	let ts: C1TestSession | undefined;

	afterEach(() => ts?.cleanup());

	it("activates only read/grep/find/ls", async () => {
		ts = await createC1TestSession();
		expect(ts.session.getActiveToolNames().sort()).toEqual(["find", "grep", "ls", "read"]);
		expect(ts.session.getActiveToolNames()).not.toContain("write");
		expect(ts.session.getActiveToolNames()).not.toContain("edit");
		expect(ts.session.getActiveToolNames()).not.toContain("bash");
	});

	it("does not write files when the faux model asks for write", async () => {
		ts = await createC1TestSession({
			responses: [
				fauxAssistantMessage(fauxToolCall("write", { path: "owned.txt", content: "should not exist" })),
				fauxAssistantMessage("I cannot write in readonly mode."),
			],
		});

		await ts.session.prompt("try to write a file");

		expect(existsSync(join(ts.cwd, "owned.txt"))).toBe(false);
		expect(ts.session.getActiveToolNames()).not.toContain("write");
		expect(ts.eventsOfType("agent_end").length).toBe(1);
	});
});
