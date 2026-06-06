import { describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY_CONFIG } from "../../src/config/loader.ts";
import type { ProjectContext } from "../../src/context/types.ts";

const injectedModel = { id: "faux-model", provider: "faux" };
const lookedUpModel = { id: "looked-up", provider: "anthropic" };

vi.mock("@earendil-works/pi-ai", () => ({
	getModel: vi.fn(() => lookedUpModel),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	DefaultResourceLoader: class {
		options: unknown;
		constructor(options: unknown) {
			this.options = options;
		}
	},
	SessionManager: {
		create: vi.fn((cwd: string) => ({ cwd })),
	},
	SettingsManager: {
		inMemory: vi.fn((settings: unknown) => ({ settings })),
	},
	createAgentSession: vi.fn(async (options: unknown) => ({ options })),
	createBashToolDefinition: vi.fn(() => ({
		name: "bash",
		label: "bash",
		description: "bash",
		parameters: {},
		execute: vi.fn(),
	})),
	createLocalBashOperations: vi.fn(() => ({ exec: vi.fn() })),
	defineTool: vi.fn((tool: unknown) => tool),
	getAgentDir: vi.fn(() => "/tmp/agent"),
}));

function ctx(): ProjectContext {
	return {
		cwd: "/tmp/project",
		mode: "workspace-write",
		goal: "test seam",
		policy: DEFAULT_POLICY_CONFIG,
		memory: "",
	};
}

describe("runtime seams", () => {
	it("appends extra extension factories after the built-in pipeline", async () => {
		const { buildExtensionFactories } = await import("../../src/runtime/resource-loader.ts");
		const extra = vi.fn();

		const factories = buildExtensionFactories(ctx(), [extra]);

		expect(factories.at(-1)).toBe(extra);
		expect(factories.length).toBeGreaterThan(1);
	});

	it("uses an injected model instead of resolving modelId", async () => {
		const { resolveModel } = await import("../../src/runtime/session-factory.ts");
		const { getModel } = await import("@earendil-works/pi-ai");

		expect(resolveModel({ model: injectedModel as never, modelId: "ignored" })).toBe(injectedModel);
		expect(getModel).not.toHaveBeenCalled();
		expect(resolveModel({ modelId: "claude-sonnet-4-6" })).toBe(lookedUpModel);
	});
});
