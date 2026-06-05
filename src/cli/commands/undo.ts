import { execFileSync } from "node:child_process";

export interface UndoOptions {
	cwd: string;
}

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function hasChanges(cwd: string): boolean {
	return git(["status", "--porcelain"], cwd).trim().length > 0;
}

export async function runUndo(opts: UndoOptions): Promise<number> {
	process.stdout.write("agent undo only reverts file changes. It cannot undo command side effects.\n");
	if (!hasChanges(opts.cwd)) {
		process.stdout.write("No file changes to undo.\n");
		return 0;
	}
	const message = `agent-cli-undo-${new Date().toISOString()}`;
	const output = git(["stash", "push", "--include-untracked", "-m", message], opts.cwd);
	process.stdout.write(output.trim() ? `${output}` : `Saved working tree snapshot: ${message}\n`);
	return 0;
}

