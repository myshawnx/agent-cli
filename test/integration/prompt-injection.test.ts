import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMemory } from "../../src/context/memory.ts";
import { detectProfile } from "../../src/context/profile.ts";
import type { ProjectContext } from "../../src/context/types.ts";
import { buildResourceLoader } from "../../src/runtime/resource-loader.ts";

describe("resource loader prompt injection", () => {
	it("injects detected profile and .agent memory into append system prompt", async () => {
		const cwd = resolve("fixtures/hono-api");
		const profile = await detectProfile(cwd);
		const ctx: ProjectContext = {
			cwd,
			mode: "readonly",
			profile,
			memory: "Remember that CI uses pnpm.",
		};
		const loader = buildResourceLoader(ctx, { agentDir: resolve("fixtures/hono-api/.pi-agent-test") });
		await loader.reload();

		const injected = loader.getAppendSystemPrompt().join("\n");
		expect(injected).toContain("Package manager: pnpm");
		expect(injected).toContain("test=pnpm test");
		expect(injected).toContain("Remember that CI uses pnpm");
	});

	it("loads AGENTS.md through pi native context-file loading", async () => {
		const cwd = resolve("fixtures/hono-api");
		const profile = await detectProfile(cwd);
		const loader = buildResourceLoader({ cwd, mode: "readonly", profile, memory: loadMemory(cwd) });
		await loader.reload();

		const agentsFiles = loader.getAgentsFiles().agentsFiles;
		expect(agentsFiles.some((f) => f.path.endsWith("AGENTS.md") && f.content.includes("Hono API"))).toBe(true);
	});
});
