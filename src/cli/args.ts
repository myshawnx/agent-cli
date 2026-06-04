/**
 * CLI definition — commander skeleton.
 *
 * C0 only implements `--version` and placeholder subcommands. Real subcommands
 * (init/ask/run/review/mcp/eval) land in C1–C5.
 */

import { Command } from "commander";
import { VERSION } from "../version.js";

function createProgram(): Command {
	const program = new Command();

	program
		.name("agent")
		.description("A local-first CLI coding assistant built on the pi agent harness (SDK, no fork).")
		.version(VERSION, "--version", "output the version number")
		.option("--cwd <path>", "working directory", process.cwd())
		.option("-p, --print", "non-interactive print mode (stdout only)")
		.option("--model <id>", "model identifier")
		.option("--mode <mode>", "approval mode: readonly | suggest | workspace-write | auto", "readonly");

	// Placeholder subcommands — real implementations land in C1–C5.
	// Each throws "not implemented" so the user gets a clear message
	// (not a mysterious crash) with the planned cycle.
	const notReady = (cycle: string): never => {
		console.error(`not implemented (planned in ${cycle})`);
		process.exit(1);
	};

	program
		.command("init")
		.description("generate .agent/ skeleton [C1]")
		.action(() => notReady("C1"));
	program
		.command("ask")
		.description("read-only Q&A [C1]")
		.action(() => notReady("C1"));
	program
		.command("review")
		.description("review git diff for risks/gaps [C2]")
		.action(() => notReady("C2"));
	program
		.command("diff")
		.description("show unified diff of current task [C3]")
		.action(() => notReady("C3"));
	program
		.command("undo")
		.description("revert file changes (files only) [C3]")
		.action(() => notReady("C3"));
	program
		.command("mcp")
		.description("manage MCP servers [C5]")
		.action(() => notReady("C5"));
	program
		.command("eval")
		.description("run benchmark scenarios [C4]")
		.action(() => notReady("C4"));

	return program;
}

export { createProgram };
