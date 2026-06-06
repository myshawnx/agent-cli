import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	readPipedStdin: vi.fn(),
	runAsk: vi.fn(),
	runDiff: vi.fn(),
	runEval: vi.fn(),
	runHistory: vi.fn(),
	runInit: vi.fn(),
	runMcp: vi.fn(),
	runResume: vi.fn(),
	runReview: vi.fn(),
	runTrace: vi.fn(),
	runUndo: vi.fn(),
}));

vi.mock("../../src/cli/stdin.ts", () => ({ readPipedStdin: mocks.readPipedStdin }));
vi.mock("../../src/cli/commands/ask.ts", () => ({ runAsk: mocks.runAsk }));
vi.mock("../../src/cli/commands/diff.ts", () => ({ runDiff: mocks.runDiff }));
vi.mock("../../src/cli/commands/eval.ts", () => ({ runEval: mocks.runEval }));
vi.mock("../../src/cli/commands/history.ts", () => ({ runHistory: mocks.runHistory }));
vi.mock("../../src/cli/commands/init.ts", () => ({ runInit: mocks.runInit }));
vi.mock("../../src/cli/commands/mcp.ts", () => ({ runMcp: mocks.runMcp }));
vi.mock("../../src/cli/commands/resume.ts", () => ({ runResume: mocks.runResume }));
vi.mock("../../src/cli/commands/review.ts", () => ({ runReview: mocks.runReview }));
vi.mock("../../src/cli/commands/trace.ts", () => ({ runTrace: mocks.runTrace }));
vi.mock("../../src/cli/commands/undo.ts", () => ({ runUndo: mocks.runUndo }));

async function parseAgentArgs(args: string[]): Promise<void> {
	const { createProgram } = await import("../../src/cli/args.ts");
	const program = createProgram();
	program.exitOverride();
	program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
	await program.parseAsync(["node", "agent", ...args], { from: "node" });
}

describe("CLI args", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mocks.readPipedStdin.mockResolvedValue(undefined);
		for (const fn of [
			mocks.runAsk,
			mocks.runDiff,
			mocks.runEval,
			mocks.runHistory,
			mocks.runInit,
			mocks.runMcp,
			mocks.runResume,
			mocks.runReview,
			mocks.runTrace,
			mocks.runUndo,
		]) {
			fn.mockResolvedValue(0);
		}
	});

	it("routes the default task through runAsk with global run options", async () => {
		await parseAgentArgs(["--cwd", "/tmp/project", "--mode", "readonly", "--model", "demo-model", "-p", "summarize"]);

		expect(mocks.runAsk).toHaveBeenCalledWith({
			cwd: "/tmp/project",
			prompt: "summarize",
			printMode: true,
			modelId: "demo-model",
			mode: "readonly",
		});
		expect(process.exitCode).toBe(0);
	});

	it("combines ask text with piped stdin", async () => {
		mocks.readPipedStdin.mockResolvedValueOnce("stack trace\nline 2\n");

		await parseAgentArgs(["ask", "--cwd", "/tmp/project", "explain", "this"]);

		expect(mocks.runAsk).toHaveBeenCalledWith({
			cwd: "/tmp/project",
			prompt: "explain this\n\nstack trace\nline 2",
			printMode: false,
			modelId: undefined,
			mode: "suggest",
		});
	});

	it("normalizes eval provider options before dispatch", async () => {
		await parseAgentArgs(["eval", "--cwd", "/tmp/project", "--provider", "unknown", "--scenario", "demo"]);

		expect(mocks.runEval).toHaveBeenCalledWith({
			cwd: "/tmp/project",
			provider: "faux",
			model: undefined,
			scenario: "demo",
			updateBaseline: false,
		});
	});
});
