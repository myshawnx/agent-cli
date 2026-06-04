/**
 * CLI definition — commander wiring for C2.
 *
 * Top-level `agent "<task>"` (and `-p` for print mode) is the primary entrypoint;
 * `init`, `ask`, and `review` are explicit subcommands. C2 wires approval modes
 * into the runtime policy gateway: readonly | suggest | workspace-write | auto.
 */

import { Command } from "commander";
import type { ApprovalMode } from "../policy/types.ts";
import { VERSION } from "../version.ts";
import { runAsk } from "./commands/ask.ts";
import { runInit } from "./commands/init.ts";
import { runReview } from "./commands/review.ts";
import { readPipedStdin } from "./stdin.ts";

const APPROVAL_MODES: ApprovalMode[] = ["readonly", "suggest", "workspace-write", "auto"];

interface RunOpts {
	cwd: string;
	print?: boolean;
	model?: string;
	mode: string;
}

interface ReviewOpts {
	cwd: string;
	mode: string;
}

const V02_NOTICE =
	"v0.2 (C2) adds a policy gateway: bash/path checks are a string-level speed bump, not an OS sandbox.\n" +
	"For a true boundary, enable sandbox support when C6 hardening lands.";

function parseApprovalMode(mode: string): ApprovalMode {
	if ((APPROVAL_MODES as string[]).includes(mode)) {
		return mode as ApprovalMode;
	}
	throw new Error(`invalid --mode "${mode}" (expected ${APPROVAL_MODES.join(" | ")})`);
}

/** Shared run options for the default action and the `ask` subcommand. */
function addRunOptions(cmd: Command): Command {
	return cmd
		.option("--cwd <path>", "working directory", process.cwd())
		.option("-p, --print", "non-interactive print mode (stdout only; confirm decisions block conservatively)")
		.option("--model <id>", "model identifier (default: anthropic claude-sonnet-4-6)")
		.option("--mode <mode>", "approval mode: readonly | suggest | workspace-write | auto", "suggest");
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

async function runWithCliError(fn: () => Promise<number>): Promise<void> {
	try {
		process.exitCode = await fn();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	}
}

function createProgram(): Command {
	const program = new Command();

	program
		.name("agent")
		.description("A local-first CLI coding assistant built on the pi agent harness (SDK, no fork).")
		.version(VERSION, "--version", "output the version number")
		.argument("[task...]", "natural-language task")
		.addHelpText("after", `\n${V02_NOTICE}\n`);
	addRunOptions(program);

	program.action(async (task: string[], opts: RunOpts) => {
		const prompt = await composePrompt(task);
		if (!prompt) {
			program.help();
			return;
		}
		await runWithCliError(() =>
			runAsk({
				cwd: opts.cwd,
				prompt,
				printMode: Boolean(opts.print),
				modelId: opts.model,
				mode: parseApprovalMode(opts.mode),
			}),
		);
	});

	program
		.command("init")
		.description("detect the project profile and scaffold .agent/")
		.option("--cwd <path>", "working directory", process.cwd())
		.option("--force", "overwrite an existing .agent/")
		.action(async (subOpts: { cwd: string; force?: boolean }) => {
			await runWithCliError(() => runInit({ cwd: subOpts.cwd, force: subOpts.force }));
		});

	const ask = program
		.command("ask")
		.description("Q&A about the project under the selected approval mode")
		.argument("[question...]", "the question");
	addRunOptions(ask);
	ask.action(async (question: string[], opts: RunOpts) => {
		const prompt = await composePrompt(question);
		if (!prompt) {
			process.stderr.write('usage: agent ask "<question>" (or pipe content via stdin)\n');
			process.exitCode = 1;
			return;
		}
		await runWithCliError(() =>
			runAsk({
				cwd: opts.cwd,
				prompt,
				printMode: Boolean(opts.print),
				modelId: opts.model,
				mode: parseApprovalMode(opts.mode),
			}),
		);
	});

	program
		.command("review")
		.description("review git diff for policy risks, missing tests, and suggestions")
		.option("--cwd <path>", "working directory", process.cwd())
		.option("--mode <mode>", "approval mode used for policy classification", "workspace-write")
		.action(async (opts: ReviewOpts) => {
			await runWithCliError(() => runReview({ cwd: opts.cwd, mode: parseApprovalMode(opts.mode) }));
		});

	// Placeholder subcommands — real implementations land in their cycles.
	const notReady = (cycle: string) => () => {
		process.stderr.write(`not implemented (planned in ${cycle})\n`);
		process.exitCode = 1;
	};
	program.command("diff").description("show unified diff of current task [C3]").action(notReady("C3"));
	program.command("undo").description("revert file changes (files only) [C3]").action(notReady("C3"));
	program.command("mcp").description("manage MCP servers [C5]").action(notReady("C5"));
	program.command("eval").description("run benchmark scenarios [C4]").action(notReady("C4"));

	return program;
}

export { createProgram };
