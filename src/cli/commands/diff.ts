import { execFileSync } from "node:child_process";

export interface DiffOptions {
	cwd: string;
}

function git(args: string[], cwd: string): string {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
	} catch (err) {
		const output = (err as { stdout?: Buffer | string }).stdout;
		return typeof output === "string" ? output : (output?.toString("utf8") ?? "");
	}
}

export async function runDiff(opts: DiffOptions): Promise<number> {
	const diff = git(["diff", "--", "."], opts.cwd);
	const staged = git(["diff", "--cached", "--", "."], opts.cwd);
	if (!diff.trim() && !staged.trim()) {
		process.stdout.write("No file diff in the current worktree.\n");
		return 0;
	}
	process.stdout.write("# Agent Diff\n\n");
	if (staged.trim()) {
		process.stdout.write("## Staged\n\n");
		process.stdout.write(staged.endsWith("\n") ? staged : `${staged}\n`);
	}
	if (diff.trim()) {
		process.stdout.write("## Unstaged\n\n");
		process.stdout.write(diff.endsWith("\n") ? diff : `${diff}\n`);
	}
	return 0;
}
