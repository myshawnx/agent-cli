/**
 * `agent review` — lightweight C2 diff review.
 *
 * This is intentionally static and local: it reads the current git diff, maps changed
 * files through the same policy engine used by the runtime gateway, and prints a
 * markdown report with policy risks, missing-test hints, and next-step suggestions.
 */

import { execFileSync } from "node:child_process";
import { loadAgentConfig } from "../../config/loader.ts";
import { classify } from "../../policy/engine.ts";
import type { ApprovalMode, PolicyConfig, PolicyToolCall, Verdict } from "../../policy/types.ts";

export interface ReviewOptions {
	cwd: string;
	mode: ApprovalMode;
}

interface ChangedFile {
	path: string;
	status: string;
}

function git(args: string[], cwd: string): string {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8" });
	} catch {
		return "";
	}
}

function parseNameStatus(output: string): ChangedFile[] {
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [status = "M", ...rest] = line.split(/\s+/);
			return { status, path: rest.at(-1) ?? "" };
		})
		.filter((f) => f.path !== "");
}

function uniqueFiles(files: ChangedFile[]): ChangedFile[] {
	const seen = new Set<string>();
	const out: ChangedFile[] = [];
	for (const f of files) {
		const key = `${f.status}:${f.path}`;
		if (!seen.has(key)) {
			seen.add(key);
			out.push(f);
		}
	}
	return out;
}

function classifyFile(
	path: string,
	mode: ApprovalMode,
	policy: PolicyConfig,
	cwd: string,
	changedFiles: number,
): Verdict {
	const event: PolicyToolCall = { toolName: "write", input: { path, content: "" } };
	return classify(event, mode, policy, { repoRoot: cwd, changedFiles });
}

function hasTests(files: ChangedFile[]): boolean {
	return files.some(
		(f) => /(^|\/)(test|tests|__tests__|spec|specs)\//.test(f.path) || /\.(test|spec)\.[tj]sx?$/.test(f.path),
	);
}

function riskLine(file: ChangedFile, verdict: Verdict): string {
	if (verdict.kind === "allow") {
		return `- ✅ ${file.path} (${file.status}) — policy allow`;
	}
	const icon = verdict.kind === "deny" ? "⛔" : "⚠️";
	return `- ${icon} ${file.path} (${file.status}) — ${verdict.kind}: ${verdict.reason}`;
}

export async function runReview(opts: ReviewOptions): Promise<number> {
	const config = loadAgentConfig(opts.cwd);
	const unstaged = parseNameStatus(git(["diff", "--name-status"], opts.cwd));
	const staged = parseNameStatus(git(["diff", "--cached", "--name-status"], opts.cwd));
	const files = uniqueFiles([...staged, ...unstaged]);

	if (files.length === 0) {
		process.stdout.write("# Agent Review\n\nNo git diff found.\n");
		return 0;
	}

	const risks = files.map((file, index) => ({
		file,
		verdict: classifyFile(file.path, opts.mode, config.policy, opts.cwd, index),
	}));
	const risky = risks.filter((r) => r.verdict.kind !== "allow");
	const testPresent = hasTests(files);

	const lines = [
		"# Agent Review",
		"",
		`Mode: ${opts.mode}`,
		`Changed files: ${files.length}`,
		"",
		"## Policy risk pass",
		...risks.map((r) => riskLine(r.file, r.verdict)),
		"",
		"## Test coverage signal",
		testPresent
			? "- ✅ Diff includes test/spec changes."
			: "- ⚠️ No test/spec files changed; consider adding or updating tests.",
		"",
		"## Suggestions",
	];

	if (risky.length > 0) {
		lines.push("- Review the warning/deny items above before asking the agent to apply changes.");
	}
	if (!testPresent) {
		lines.push("- Add focused regression coverage for the touched behavior, then run the project test command.");
	}
	lines.push("- Remember: bash/path policy checks are a string-level speed bump, not an OS sandbox.");

	process.stdout.write(`${lines.join("\n")}\n`);
	return 0;
}
