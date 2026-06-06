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
import { runResume } from "./commands/resume.ts";
import { runReview } from "./commands/review.ts";
import { runTrace } from "./commands/trace.ts";
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

type OptionBag = Record<string, unknown>;

const V10_NOTICE =
	"v1.0 ships policy → loop guards → trace → MCP plus deterministic faux evals.\n" +
	"Policy checks are a string-level speed bump, not an OS sandbox; undo is file-only.";

function parseApprovalMode(mode: string): ApprovalMode {
	if ((APPROVAL_MODES as string[]).includes(mode)) {
		return mode as ApprovalMode;
	}
	throw new Error(`invalid --mode "${mode}" (expected ${APPROVAL_MODES.join(" | ")})`);
}

function explicitOption(command: Command | undefined, key: string): unknown {
	for (let current: Command | null | undefined = command; current; current = current.parent) {
		const source = current.getOptionValueSource(key);
		if (source && source !== "default") {
			return current.getOptionValue(key);
		}
	}
	return undefined;
}

function optionValue<T>(opts: OptionBag | undefined, command: Command | undefined, key: string, fallback: T): T {
	const explicit = explicitOption(command, key);
	if (explicit !== undefined) {
		return explicit as T;
	}
	const local = opts?.[key];
	return (local === undefined ? fallback : local) as T;
}

function cwdOption(opts: OptionBag | undefined, command: Command | undefined): string {
	return optionValue(opts, command, "cwd", process.cwd());
}

function modeOption(opts: OptionBag | undefined, command: Command | undefined, fallback: ApprovalMode): ApprovalMode {
	return parseApprovalMode(optionValue(opts, command, "mode", fallback));
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

	program.action(async (task: string[], opts: RunOpts, command: Command) => {
		const prompt = await composePrompt(task);
		if (!prompt) {
			program.help();
			return;
		}
		await runWithCliError(() =>
			runAsk({
				cwd: cwdOption(opts as unknown as OptionBag, command),
				prompt,
				printMode: Boolean(optionValue(opts as unknown as OptionBag, command, "print", false)),
				modelId: optionValue<string | undefined>(opts as unknown as OptionBag, command, "model", undefined),
				mode: modeOption(opts as unknown as OptionBag, command, "suggest"),
			}),
		);
	});

	program
		.command("init")
		.description("detect the project profile and scaffold .agent/")
		.option("--cwd <path>", "working directory", process.cwd())
		.option("--force", "overwrite an existing .agent/")
		.action(async (subOpts: { cwd: string; force?: boolean }, command: Command) => {
			await runWithCliError(() => runInit({ cwd: cwdOption(subOpts as OptionBag, command), force: subOpts.force }));
		});

	const ask = program
		.command("ask")
		.description("Q&A about the project under the selected approval mode")
		.argument("[question...]", "the question");
	addRunOptions(ask);
	ask.action(async (question: string[], opts: RunOpts, command: Command) => {
		const prompt = await composePrompt(question);
		if (!prompt) {
			process.stderr.write('usage: agent ask "<question>" (or pipe content via stdin)\n');
			process.exitCode = 1;
			return;
		}
		await runWithCliError(() =>
			runAsk({
				cwd: cwdOption(opts as unknown as OptionBag, command),
				prompt,
				printMode: Boolean(optionValue(opts as unknown as OptionBag, command, "print", false)),
				modelId: optionValue<string | undefined>(opts as unknown as OptionBag, command, "model", undefined),
				mode: modeOption(opts as unknown as OptionBag, command, "suggest"),
			}),
		);
	});

	program
		.command("review")
		.description("review git diff for policy risks, missing tests, and suggestions")
		.option("--cwd <path>", "working directory", process.cwd())
		.option("--mode <mode>", "approval mode used for policy classification", "workspace-write")
		.action(async (opts: ReviewOpts, command: Command) => {
			await runWithCliError(() =>
				runReview({
					cwd: cwdOption(opts as unknown as OptionBag, command),
					mode: modeOption(opts as unknown as OptionBag, command, "workspace-write"),
				}),
			);
		});

	program
		.command("history")
		.description("list pi sessions for the current cwd")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (opts: { cwd: string }, command: Command) => {
			await runWithCliError(() => runHistory({ cwd: cwdOption(opts as OptionBag, command) }));
		});

	program
		.command("trace")
		.description("show the task-trace summary (TaskView) for a session (default: most recent)")
		.argument("[id]", "session id or session JSONL path")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (id: string | undefined, opts: { cwd: string }, command: Command) => {
			await runWithCliError(() => runTrace({ cwd: cwdOption(opts as OptionBag, command), session: id }));
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
	resume.action(async (id: string, task: string[], opts: RunOpts, command: Command) => {
		const prompt = await composePrompt(task);
		await runWithCliError(() =>
			runResume({
				cwd: cwdOption(opts as unknown as OptionBag, command),
				session: id,
				prompt,
				printMode: Boolean(optionValue(opts as unknown as OptionBag, command, "print", false)),
				modelId: optionValue<string | undefined>(opts as unknown as OptionBag, command, "model", undefined),
				mode: modeOption(opts as unknown as OptionBag, command, "suggest"),
			}),
		);
	});

	program
		.command("diff")
		.description("show staged and unstaged file diff for the current task")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (opts: { cwd: string }, command: Command) => {
			await runWithCliError(() => runDiff({ cwd: cwdOption(opts as OptionBag, command) }));
		});

	program
		.command("undo")
		.description("revert file changes by stashing them (files only; command side effects are not undone)")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (opts: { cwd: string }, command: Command) => {
			await runWithCliError(() => runUndo({ cwd: cwdOption(opts as OptionBag, command) }));
		});

	program
		.command("eval")
		.description("run deterministic eval scenarios and render a regression matrix")
		.option("--cwd <path>", "repo root containing eval/fixtures", process.cwd())
		.option("--provider <provider>", "provider: faux | real", "faux")
		.option("--model <id>", "model label for the report")
		.option("--scenario <id>", "run a single scenario")
		.option("--update-baseline", "write .agent/eval/baseline.json")
		.action(async (opts: EvalOpts, command: Command) => {
			const provider = opts.provider === "real" ? "real" : "faux";
			await runWithCliError(() =>
				runEval({
					cwd: cwdOption(opts as unknown as OptionBag, command),
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
		.action(async (opts: McpOpts, command: Command) => {
			await runWithCliError(() => runMcp({ cwd: cwdOption(opts as unknown as OptionBag, command), action: "list" }));
		});
	mcp
		.command("add")
		.description("add or update an MCP stdio server")
		.argument("<name>", "server name")
		.requiredOption("--command <cmd>", "stdio server command")
		.option("--args <args>", "stdio server arguments")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (name: string, opts: McpOpts, command: Command) => {
			await runWithCliError(() =>
				runMcp({
					cwd: cwdOption(opts as unknown as OptionBag, command),
					action: "add",
					name,
					command: opts.command,
					args: opts.args,
				}),
			);
		});
	mcp
		.command("remove")
		.description("remove an MCP server")
		.argument("<name>", "server name")
		.option("--cwd <path>", "working directory", process.cwd())
		.action(async (name: string, opts: McpOpts, command: Command) => {
			await runWithCliError(() =>
				runMcp({ cwd: cwdOption(opts as unknown as OptionBag, command), action: "remove", name }),
			);
		});

	return program;
}

export { createProgram };
