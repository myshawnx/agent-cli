/**
 * CLI definition — commander wiring for C1.
 *
 * Top-level `agent "<task>"` (and `-p` for print mode) is the primary entrypoint;
 * `init` and `ask` are explicit subcommands. `review/diff/undo/mcp/eval` remain
 * placeholders until their cycles (C2–C5). Profile/memory injection and the
 * readonly tool allowlist live below this layer — args only parses and dispatches.
 */

import { Command } from "commander";
import { VERSION } from "../version.ts";
import { runAsk } from "./commands/ask.ts";
import { runInit } from "./commands/init.ts";
import { readPipedStdin } from "./stdin.ts";

interface RunOpts {
	cwd: string;
	print?: boolean;
	model?: string;
	mode: string;
}

const V01_NOTICE =
	"v0.1 (C1) is READ-ONLY: it understands and answers questions about the project but\n" +
	"never writes files or runs commands. The safety/approval policy layer lands in v0.2.";

/** Shared run options for the default action and the `ask` subcommand. */
function addRunOptions(cmd: Command): Command {
	return cmd
		.option("--cwd <path>", "working directory", process.cwd())
		.option("-p, --print", "non-interactive print mode (stdout only)")
		.option("--model <id>", "model identifier (default: anthropic claude-sonnet-4-6)")
		.option("--mode <mode>", "approval mode (v0.1: readonly only)", "readonly");
}

/** Warn (once) if a non-readonly mode was requested — C1 only does readonly. */
function noticeIfUnsupportedMode(mode: string): void {
	if (mode !== "readonly") {
		process.stderr.write(`note: --mode "${mode}" is not supported in v0.1; running read-only.\n`);
	}
}

/** Combine typed task words with any piped stdin into a single prompt. */
async function composePrompt(parts: string[]): Promise<string> {
	const typed = parts.join(" ").trim();
	const piped = (await readPipedStdin())?.trim();
	if (typed && piped) {
		return `${typed}\n\n${piped}`;
	}
	return typed || piped || "";
}

function createProgram(): Command {
	const program = new Command();

	program
		.name("agent")
		.description("A local-first CLI coding assistant built on the pi agent harness (SDK, no fork).")
		.version(VERSION, "--version", "output the version number")
		.argument("[task...]", "natural-language task for read-only Q&A")
		.addHelpText("after", `\n${V01_NOTICE}\n`);
	addRunOptions(program);

	program.action(async (task: string[], opts: RunOpts) => {
		const prompt = await composePrompt(task);
		if (!prompt) {
			program.help();
			return;
		}
		noticeIfUnsupportedMode(opts.mode);
		const code = await runAsk({ cwd: opts.cwd, prompt, printMode: Boolean(opts.print), modelId: opts.model });
		process.exitCode = code;
	});

	program
		.command("init")
		.description("detect the project profile and scaffold .agent/")
		.option("--cwd <path>", "working directory", process.cwd())
		.option("--force", "overwrite an existing .agent/")
		.action(async (subOpts: { cwd: string; force?: boolean }) => {
			const code = await runInit({ cwd: subOpts.cwd, force: subOpts.force });
			process.exitCode = code;
		});

	const ask = program
		.command("ask")
		.description("read-only Q&A about the project")
		.argument("[question...]", "the question");
	addRunOptions(ask);
	ask.action(async (question: string[], opts: RunOpts) => {
		const prompt = await composePrompt(question);
		if (!prompt) {
			process.stderr.write('usage: agent ask "<question>" (or pipe content via stdin)\n');
			process.exitCode = 1;
			return;
		}
		noticeIfUnsupportedMode(opts.mode);
		const code = await runAsk({ cwd: opts.cwd, prompt, printMode: Boolean(opts.print), modelId: opts.model });
		process.exitCode = code;
	});

	// Placeholder subcommands — real implementations land in their cycles.
	const notReady = (cycle: string) => () => {
		process.stderr.write(`not implemented (planned in ${cycle})\n`);
		process.exitCode = 1;
	};
	program.command("review").description("review git diff for risks/gaps [C2]").action(notReady("C2"));
	program.command("diff").description("show unified diff of current task [C3]").action(notReady("C3"));
	program.command("undo").description("revert file changes (files only) [C3]").action(notReady("C3"));
	program.command("mcp").description("manage MCP servers [C5]").action(notReady("C5"));
	program.command("eval").description("run benchmark scenarios [C4]").action(notReady("C4"));

	return program;
}

export { createProgram };
