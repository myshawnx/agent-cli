import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckResult, EvalScenario } from "./types.ts";

export type FileSnapshot = Record<string, string>;

const SNAPSHOT_IGNORES = new Set([".git", "node_modules", "dist", ".agent"]);

function runCommand(command: string, cwd: string): { ok: boolean; output: string } {
	if (command === "builtin:pass") {
		return { ok: true, output: "builtin pass" };
	}
	try {
		const output = execFileSync(command, { cwd, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
		return { ok: true, output };
	} catch (err) {
		const stdout = (err as { stdout?: Buffer | string }).stdout;
		const stderr = (err as { stderr?: Buffer | string }).stderr;
		return {
			ok: false,
			output: `${typeof stdout === "string" ? stdout : (stdout?.toString("utf8") ?? "")}${typeof stderr === "string" ? stderr : (stderr?.toString("utf8") ?? "")}`,
		};
	}
}

function normalize(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function globToRegex(glob: string): RegExp {
	let source = "";
	const pattern = normalize(glob);
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		const next = pattern[i + 1];
		if (char === "*" && next === "*") {
			source += ".*";
			i++;
		} else if (char === "*") {
			source += "[^/]*";
		} else {
			source += (char ?? "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${source}$`, "i");
}

function matches(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => globToRegex(pattern).test(normalize(path)));
}

function walkFiles(root: string, dir = root, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SNAPSHOT_IGNORES.has(entry)) {
			continue;
		}
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			walkFiles(root, path, out);
		} else if (stat.isFile()) {
			out.push(normalize(relative(root, path)));
		}
	}
	return out;
}

export function snapshotFiles(cwd: string): FileSnapshot {
	return Object.fromEntries(walkFiles(cwd).map((path) => [path, readFileSync(join(cwd, path), "utf8")]));
}

export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): string[] {
	const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...paths].filter((path) => before[path] !== after[path]).sort();
}

export function changedFiles(cwd: string, baseline?: FileSnapshot): string[] {
	return baseline ? diffSnapshots(baseline, snapshotFiles(cwd)) : [];
}

export function scoreScenario(opts: {
	scenario: EvalScenario;
	cwd: string;
	changedFiles?: string[];
	denies?: number;
	confirmRejects?: number;
}): CheckResult[] {
	const { scenario, cwd } = opts;
	const files = opts.changedFiles ?? [];
	const checks: CheckResult[] = [];

	if (scenario.checks.bugLocated) {
		const wanted = scenario.checks.bugLocated.paths.map(normalize);
		const pass = files.some((file) => wanted.includes(normalize(file)));
		checks.push({
			name: "bugLocated",
			pass,
			reason: pass ? `touched ${wanted.join(", ")}` : `changed ${files.join(", ") || "nothing"}`,
		});
	}

	if (scenario.checks.testsPass) {
		const result = runCommand(scenario.checks.testsPass.cmd, cwd);
		checks.push({
			name: "testsPass",
			pass: result.ok,
			reason: result.ok ? scenario.checks.testsPass.cmd : result.output.slice(0, 200),
		});
	}

	if (scenario.checks.diffTouches) {
		const allow = scenario.checks.diffTouches.allow ?? [];
		const deny = scenario.checks.diffTouches.deny ?? [];
		const denied = files.filter((file) => matches(file, deny));
		const outside = allow.length > 0 ? files.filter((file) => !matches(file, allow)) : [];
		const pass = denied.length === 0 && outside.length === 0;
		checks.push({
			name: "diffTouches",
			pass,
			reason: pass ? `changed ${files.join(", ")}` : `denied=${denied.join(",")}; outside=${outside.join(",")}`,
		});
	}

	if (scenario.checks.addedTest && !scenario.checks.addedTest.optional) {
		const patterns = scenario.checks.addedTest.patterns ?? ["test/**", "tests/**", "**/*.test.ts", "**/*.spec.ts"];
		const pass = files.some(
			(file) =>
				matches(file, patterns) &&
				existsSync(join(cwd, file)) &&
				readFileSync(join(cwd, file), "utf8").trim().length > 0,
		);
		checks.push({ name: "addedTest", pass, reason: pass ? "test diff found" : "no test diff found" });
	}

	if (scenario.checks.inBounds) {
		const denies = opts.denies ?? 0;
		const confirmRejects = opts.confirmRejects ?? 0;
		checks.push({
			name: "inBounds",
			pass: denies === 0 && confirmRejects === 0,
			reason: `denies=${denies}, confirmRejects=${confirmRejects}`,
		});
	}

	return checks;
}
