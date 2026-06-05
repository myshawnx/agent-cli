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
import { runDiff } from "./commands/diff.ts";
import { runEval } from "./commands/eval.ts";
import { runHistory } from "./commands/history.ts";
import { runInit } from "./commands/init.ts";
import { runMcp } from "./commands/mcp.ts";
import { runReview } from "./commands/review.ts";
import { runResume } from "./commands/resume.ts";
import { runUndo } from "./commands/undo.ts";
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

interface EvalOpts {
	cwd: string;
	provider: "faux" | "real";
	model?: string;
	scenario?: string;
	updateBaseline?: boolean;
}

interface McpOpts {
	cwd: string;
	command?: string;
	args?: string;
}

const V10_NOTICE =
	"v1.0 ships policy → loop guards → trace → MCP plus deterministic faux evals.\n" +
	"Policy checks are a string-level speed bump, not an OS sandbox; undo is file-only.";

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
		.addHelpText("after", `\n${V10_NOTICE}\n`);
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

	program
		.command("history")
		.description("list pi sessions for the current cwd")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (opts: { cwd: string }) => {
			await runWithCliError(() => runHistory({ cwd: opts.cwd }));
		});

	const resume = program
		.command("resume")
		.description("resume a pi session by id or path")
		.argument("<id>", "session id or session JSONL path")
		.argument("[task...]", "follow-up prompt")
		.option("--cwd <path>", "working directory", process.cwd())
		.option("-p, --print", "non-interactive print mode")
		.option("--model <id>", "model identifier")
		.option("--mode <mode>", "approval mode: readonly | suggest | workspace-write | auto", "suggest");
	resume.action(async (id: string, task: string[], opts: RunOpts) => {
		const prompt = await composePrompt(task);
		await runWithCliError(() =>
			runResume({
				cwd: opts.cwd,
				session: id,
				prompt,
				printMode: Boolean(opts.print),
				modelId: opts.model,
				mode: parseApprovalMode(opts.mode),
			}),
		);
	});

	program
		.command("diff")
		.description("show staged and unstaged file diff for the current task")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (opts: { cwd: string }) => {
			await runWithCliError(() => runDiff({ cwd: opts.cwd }));
		});

	program
		.command("undo")
		.description("revert file changes by stashing them (files only; command side effects are not undone)")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (opts: { cwd: string }) => {
			await runWithCliError(() => runUndo({ cwd: opts.cwd }));
		});

	program
		.command("eval")
		.description("run deterministic eval scenarios and render a regression matrix")
		.option("--cwd <path>", "repo root containing eval/fixtures", process.cwd())
		.option("--provider <provider>", "provider: faux | real", "faux")
		.option("--model <id>", "model label for the report")
		.option("--scenario <id>", "run a single scenario")
		.option("--update-baseline", "write .agent/eval/baseline.json")
		.action(async (opts: EvalOpts) => {
			const provider = opts.provider === "real" ? "real" : "faux";
			await runWithCliError(() =>
				runEval({
					cwd: opts.cwd,
					provider,
					model: opts.model,
					scenario: opts.scenario,
					updateBaseline: Boolean(opts.updateBaseline),
				}),
			);
		});

	const mcp = program.command("mcp").description("manage MCP stdio servers");
	mcp
		.command("list")
		.description("list configured MCP servers")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (opts: McpOpts) => {
			await runWithCliError(() => runMcp({ cwd: opts.cwd, action: "list" }));
		});
	mcp
		.command("add")
		.description("add or update an MCP stdio server")
		.argument("<name>", "server name")
		.requiredOption("--command <cmd>", "stdio server command")
		.option("--args <args>", "stdio server arguments")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (name: string, opts: McpOpts) => {
			await runWithCliError(() => runMcp({ cwd: opts.cwd, action: "add", name, command: opts.command, args: opts.args }));
		});
	mcp
		.command("remove")
		.description("remove an MCP server")
		.argument("<name>", "server name")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (name: string, opts: McpOpts) => {
			await runWithCliError(() => runMcp({ cwd: opts.cwd, action: "remove", name }));
		});

	return program;
}

export { createProgram };
