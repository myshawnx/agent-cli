/**
 * Behavioral tests for the `loopGuards` extension (C3 control-flow guards, hardened
 * in C6 T6.4 + T6.6). The factory only touches the pi host through `.on`,
 * `.appendEntry`, and `.sendMessage`, so a tiny mock host lets us drive the event
 * stream deterministically without a real pi session (which needs Node >=22 here).
 */

import { describe, expect, it } from "vitest";
import { loopGuards } from "../../src/loop/guards.ts";
import type { LoopGuardOptions } from "../../src/loop/types.ts";

type Handler = (event: unknown, ctx?: unknown) => unknown;
type PiHost = Parameters<ReturnType<typeof loopGuards>>[0];

interface GuardEntry {
	kind: string;
	data: Record<string, unknown>;
}
interface SentMessage {
	message: Record<string, unknown>;
	opts: unknown;
}

function createMockPi() {
	const handlers = new Map<string, Handler>();
	const entries: GuardEntry[] = [];
	const messages: SentMessage[] = [];
	const pi = {
		on(type: string, handler: Handler) {
			handlers.set(type, handler);
		},
		appendEntry(kind: string, data: Record<string, unknown>) {
			entries.push({ kind, data });
		},
		sendMessage(message: Record<string, unknown>, opts: unknown) {
			messages.push({ message, opts });
		},
	};
	return {
		pi: pi as unknown as PiHost,
		entries,
		messages,
		emit: (type: string, event: unknown, ctx?: unknown) => handlers.get(type)?.(event, ctx),
	};
}

function install(options: Partial<LoopGuardOptions> = {}) {
	const mock = createMockPi();
	const opts: LoopGuardOptions = {
		cwd: "/repo",
		maxToolCalls: 50,
		maxFixIterations: 5,
		...options,
	};
	loopGuards(opts)(mock.pi);
	mock.emit("agent_start", {});
	return mock;
}

function assistantUsage(totalTokens: number) {
	return {
		message: {
			role: "assistant",
			usage: { totalTokens, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	};
}

function hasGuardKind(entries: GuardEntry[], kind: string): boolean {
	return entries.some((e) => e.kind === "loop-guard" && e.data.kind === kind);
}

describe("loopGuards token budget (T6.6)", () => {
	it("soft-stops once usage crosses the budget and blocks the next tool_call", () => {
		const mock = install({ tokenBudget: 100 });

		mock.emit("message_end", assistantUsage(150));

		expect(hasGuardKind(mock.entries, "token-budget-exceeded")).toBe(true);
		expect(mock.messages).toHaveLength(1);
		expect(mock.messages[0]?.message.customType).toBe("loop-guard-stop");

		const blocked = mock.emit("tool_call", { toolName: "read", input: { path: "src/a.ts" } });
		expect(blocked).toMatchObject({ block: true });
		expect(String((blocked as { reason?: string }).reason)).toContain("tokenBudget");
		expect(hasGuardKind(mock.entries, "token-budget-block")).toBe(true);
	});

	it("does not stop while usage stays under the budget", () => {
		const mock = install({ tokenBudget: 1_000 });

		mock.emit("message_end", assistantUsage(200));

		expect(hasGuardKind(mock.entries, "token-budget-exceeded")).toBe(false);
		expect(mock.emit("tool_call", { toolName: "read", input: { path: "src/a.ts" } })).toBeUndefined();
	});
});

describe("loopGuards maxToolCalls budget", () => {
	it("blocks once the tool-call budget is exceeded", () => {
		const mock = install({ maxToolCalls: 2 });

		expect(mock.emit("tool_call", { toolName: "read", input: {} })).toBeUndefined();
		expect(mock.emit("tool_call", { toolName: "read", input: {} })).toBeUndefined();
		const blocked = mock.emit("tool_call", { toolName: "read", input: {} });

		expect(blocked).toMatchObject({ block: true });
		expect(String((blocked as { reason?: string }).reason)).toContain("maxToolCalls");
		expect(hasGuardKind(mock.entries, "budget-block")).toBe(true);
	});
});

describe("loopGuards reward-hacking guard", () => {
	it("blocks writes to test files during a fix-test goal", () => {
		const mock = install({ goal: "fix the failing tests" });

		const blocked = mock.emit("tool_call", { toolName: "write", input: { path: "src/auth.test.ts" } });

		expect(blocked).toMatchObject({ block: true });
		expect(String((blocked as { reason?: string }).reason)).toContain("reward-hacking");
		expect(hasGuardKind(mock.entries, "reward-hacking-block")).toBe(true);
	});

	it("allows test writes when the goal is explicitly to author tests", () => {
		const mock = install({ goal: "fix the bug and add a regression test" });

		expect(mock.emit("tool_call", { toolName: "write", input: { path: "src/auth.test.ts" } })).toBeUndefined();
	});

	it("does not interfere with non-test-fix goals", () => {
		const mock = install({ goal: "explain the repo structure" });

		expect(mock.emit("tool_call", { toolName: "write", input: { path: "src/auth.test.ts" } })).toBeUndefined();
	});
});

describe("loopGuards patch-locate failure (T6.4)", () => {
	const failure = {
		toolName: "edit",
		isError: true,
		input: { path: "src/a.ts" },
		content: [{ type: "text", text: "Could not find the exact text to replace" }],
	};

	it("soft-stops and records an entry when there is no UI", async () => {
		const mock = install();

		await mock.emit("tool_result", failure, { hasUI: false });

		expect(mock.entries.some((e) => e.kind === "patch-locate-failed")).toBe(true);
		expect(mock.messages.some((m) => m.message.customType === "loop-guard-stop")).toBe(true);
	});

	it("steers a retry when the user confirms in interactive mode", async () => {
		const mock = install();

		await mock.emit("tool_result", failure, { hasUI: true, ui: { confirm: async () => true } });

		expect(mock.messages.some((m) => m.message.customType === "patch-locate-failed")).toBe(true);
		expect(mock.messages.some((m) => m.message.customType === "loop-guard-stop")).toBe(false);
	});

	it("soft-stops when the user declines the retry", async () => {
		const mock = install();

		await mock.emit("tool_result", failure, { hasUI: true, ui: { confirm: async () => false } });

		expect(mock.messages.some((m) => m.message.customType === "loop-guard-stop")).toBe(true);
	});
});

describe("loopGuards no-progress detection", () => {
	it("soft-stops after the same test failure repeats maxFixIterations times", async () => {
		const mock = install({ maxFixIterations: 2 });
		const failingTest = {
			toolName: "bash",
			isError: true,
			input: { command: "npm test" },
			content: [{ type: "text", text: "FAIL src/auth.test.ts\nAssertionError: expected 500 to be 401" }],
		};

		await mock.emit("tool_result", failingTest, { hasUI: false });
		expect(mock.messages.some((m) => m.message.customType === "loop-guard-stop")).toBe(false);

		await mock.emit("tool_result", failingTest, { hasUI: false });

		expect(hasGuardKind(mock.entries, "no-progress-soft-stop")).toBe(true);
		expect(mock.messages.some((m) => m.message.customType === "loop-guard-stop")).toBe(true);
	});
});
