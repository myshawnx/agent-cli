import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { projectTaskFromEntries } from "../../src/trace/projection.ts";

function custom(customType: string, data: unknown, id: string): SessionEntry {
	return { type: "custom", id, parentId: null, timestamp: new Date(0).toISOString(), customType, data };
}

describe("task projection", () => {
	it("projects task metadata from pi custom entries", () => {
		const view = projectTaskFromEntries([
			custom("task-meta", { goal: "fix auth", mode: "workspace-write", startedAt: "t1" }, "1"),
			custom("task-tool-call", { tool: "read" }, "2"),
			custom("task-modified-file", { path: "src/auth.ts" }, "3"),
			custom("task-result", { status: "completed", endedAt: "t2", turns: 1, toolCalls: 1, modifiedFiles: ["src/auth.ts"] }, "4"),
		]);

		expect(view.goal).toBe("fix auth");
		expect(view.status).toBe("completed");
		expect(view.modifiedFiles).toEqual(["src/auth.ts"]);
	});
});

