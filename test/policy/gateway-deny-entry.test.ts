/**
 * The gateway must record every blocked decision in the pi session as a
 * `policy-deny` entry — this is the single-source-of-truth signal the eval harness
 * reads for `inBounds` scoring (overview §3.2). The pure engine is covered in
 * engine.test.ts; here we assert the gateway's entry-writing side effect using a
 * mock pi host (no real session needed on Node 20).
 */

import { describe, expect, it } from "vitest";
import { policyGateway } from "../../src/policy/gateway.ts";
import type { PolicyConfig } from "../../src/policy/types.ts";

type Handler = (event: unknown, ctx?: unknown) => unknown;
type PiHost = Parameters<ReturnType<typeof policyGateway>>[0];

interface GatewayEntry {
	kind: string;
	data: Record<string, unknown>;
}

const policy: PolicyConfig = {
	command: { allow: ["pnpm test"], confirm: ["git push"], deny: ["rm -rf", "curl | sh"] },
	path: { deny: [".env", ".git/**", "**/*.pem"], confirmWrite: ["package.json"] },
	limits: { maxChangedFiles: 20, maxFixIterations: 5, maxToolCalls: 50 },
	sandbox: { enabled: false },
};

function createMockPi() {
	const handlers = new Map<string, Handler>();
	const entries: GatewayEntry[] = [];
	const pi = {
		on(type: string, handler: Handler) {
			handlers.set(type, handler);
		},
		appendEntry(kind: string, data: Record<string, unknown>) {
			entries.push({ kind, data });
		},
	};
	return {
		pi: pi as unknown as PiHost,
		entries,
		emit: (type: string, event: unknown, ctx?: unknown) => handlers.get(type)?.(event, ctx),
	};
}

function denies(entries: GatewayEntry[]): GatewayEntry[] {
	return entries.filter((e) => e.kind === "policy-deny");
}

describe("policy gateway deny recording (overview §3.2)", () => {
	it("writes a policy-deny entry when a verdict is deny", async () => {
		const mock = createMockPi();
		policyGateway(policy, "workspace-write", "/repo")(mock.pi);
		mock.emit("agent_start", {});

		const result = await mock.emit("tool_call", { toolName: "read", input: { path: ".env" } }, { hasUI: false });

		expect(result).toMatchObject({ block: true });
		expect(denies(mock.entries)).toHaveLength(1);
		expect(denies(mock.entries)[0]?.data.tool).toBe("read");
	});

	it("writes a policy-deny entry when a confirm is blocked without a UI", async () => {
		const mock = createMockPi();
		policyGateway(policy, "workspace-write", "/repo")(mock.pi);
		mock.emit("agent_start", {});

		const result = await mock.emit("tool_call", { toolName: "bash", input: { command: "git push" } }, { hasUI: false });

		expect(result).toMatchObject({ block: true });
		expect(denies(mock.entries).length).toBeGreaterThan(0);
	});

	it("does not record a deny for an allowed tool call", async () => {
		const mock = createMockPi();
		policyGateway(policy, "workspace-write", "/repo")(mock.pi);
		mock.emit("agent_start", {});

		const result = await mock.emit(
			"tool_call",
			{ toolName: "read", input: { path: "src/index.ts" } },
			{ hasUI: false },
		);

		expect(result).toBeUndefined();
		expect(denies(mock.entries)).toHaveLength(0);
	});
});
