/**
 * Project profile: detect → persist → render.
 *
 * `detectProfile` sniffs the stack (TS/JS, Python, Go), package manager (from the
 * lockfile), framework / test framework (from deps), source & test dirs, and the
 * test/lint/build commands. The persisted profile (`.agent/project-profile.json`)
 * and its rendered form are injected into the system prompt so the agent knows how
 * to test/build the project without re-deriving it every turn.
 *
 * IO is delegated to the C0 config layer (`writer.writeProfile` / `loader.loadAgentConfig`)
 * so there is exactly one validation + atomic-write path. The `ProjectProfile`
 * *shape* also comes from C0 (`config/schema.ts`) — single source of truth.
 *
 * Known limitation (overview §8 / tech-doc §7): single-repo detection only.
 * Monorepos / workspaces fall back to a minimal profile rather than mis-detecting.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadAgentConfig } from "../config/loader.ts";
import type { ProjectProfile } from "../config/schema.ts";
import { writeProfile } from "../config/writer.ts";

const SOURCE_DIR_CANDIDATES = ["src", "lib", "app", "source", "pkg", "internal"];
const TEST_DIR_CANDIDATES = ["test", "tests", "__tests__", "spec", "specs"];

// Ordered by specificity; first match wins.
const JS_FRAMEWORKS: Array<[dep: string, name: string]> = [
	["next", "next"],
	["nuxt", "nuxt"],
	["@sveltejs/kit", "sveltekit"],
	["@nestjs/core", "nestjs"],
	["@angular/core", "angular"],
	["remix", "remix"],
	["hono", "hono"],
	["express", "express"],
	["fastify", "fastify"],
	["koa", "koa"],
	["react", "react"],
	["vue", "vue"],
	["svelte", "svelte"],
];

const JS_TEST_FRAMEWORKS: Array<[dep: string, name: string]> = [
	["vitest", "vitest"],
	["jest", "jest"],
	["mocha", "mocha"],
	["ava", "ava"],
	["@playwright/test", "playwright"],
	["jasmine", "jasmine"],
	["uvu", "uvu"],
	["tap", "tap"],
];

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function existingDirs(cwd: string, candidates: string[]): string[] {
	return candidates.filter((d) => isDir(join(cwd, d)));
}

function asStringRecord(value: unknown): Record<string, string> {
	return value && typeof value === "object" ? (value as Record<string, string>) : {};
}

function pick(deps: Record<string, string>, candidates: Array<[string, string]>): string | undefined {
	for (const [dep, name] of candidates) {
		if (dep in deps) {
			return name;
		}
	}
	return undefined;
}

function detectJsPackageManager(cwd: string): string {
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
	if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
	if (existsSync(join(cwd, "package-lock.json"))) return "npm";
	return "npm";
}

function detectPyPackageManager(cwd: string, pyproject: string): string {
	if (existsSync(join(cwd, "poetry.lock")) || /\[tool\.poetry\]/.test(pyproject)) return "poetry";
	if (existsSync(join(cwd, "pdm.lock")) || /\[tool\.pdm\]/.test(pyproject)) return "pdm";
	if (existsSync(join(cwd, "uv.lock")) || /\[tool\.uv\]/.test(pyproject)) return "uv";
	if (existsSync(join(cwd, "Pipfile"))) return "pipenv";
	return "pip";
}

function detectNode(cwd: string): ProjectProfile | undefined {
	const pkg = readJson(join(cwd, "package.json"));
	if (!pkg) {
		return undefined;
	}
	const deps = { ...asStringRecord(pkg.dependencies), ...asStringRecord(pkg.devDependencies) };
	const scripts = asStringRecord(pkg.scripts);
	const pm = detectJsPackageManager(cwd);
	const isTs = existsSync(join(cwd, "tsconfig.json")) || "typescript" in deps;

	const commands: ProjectProfile["commands"] = {};
	// `<pm> test` works for npm/pnpm/yarn/bun; lint/build use `<pm> run <name>` (npm needs the `run`).
	if (scripts.test) commands.test = `${pm} test`;
	if (scripts.lint) commands.lint = `${pm} run lint`;
	if (scripts.build) commands.build = `${pm} run build`;

	const profile: ProjectProfile = {
		language: isTs ? "typescript" : "javascript",
		packageManager: pm,
		sourceDirs: existingDirs(cwd, SOURCE_DIR_CANDIDATES),
		testDirs: existingDirs(cwd, TEST_DIR_CANDIDATES),
		commands,
	};
	const framework = pick(deps, JS_FRAMEWORKS);
	if (framework) profile.framework = framework;
	const testFramework = pick(deps, JS_TEST_FRAMEWORKS);
	if (testFramework) {
		profile.testFramework = testFramework;
		if (!profile.commands.test) profile.commands.test = `${pm} run test`;
	}
	return profile;
}

function detectPython(cwd: string): ProjectProfile | undefined {
	const pyproject = readText(join(cwd, "pyproject.toml"));
	const hasPy =
		pyproject !== "" ||
		existsSync(join(cwd, "setup.py")) ||
		existsSync(join(cwd, "requirements.txt")) ||
		existsSync(join(cwd, "Pipfile"));
	if (!hasPy) {
		return undefined;
	}
	const profile: ProjectProfile = {
		language: "python",
		packageManager: detectPyPackageManager(cwd, pyproject),
		sourceDirs: existingDirs(cwd, SOURCE_DIR_CANDIDATES),
		testDirs: existingDirs(cwd, TEST_DIR_CANDIDATES),
		commands: {},
	};
	const haystack = `${pyproject}\n${readText(join(cwd, "requirements.txt"))}\n${readText(join(cwd, "Pipfile"))}`;
	if (/pytest/.test(haystack)) {
		profile.testFramework = "pytest";
		profile.commands.test = "pytest";
	}
	return profile;
}

function detectGo(cwd: string): ProjectProfile | undefined {
	if (!existsSync(join(cwd, "go.mod"))) {
		return undefined;
	}
	return {
		language: "go",
		packageManager: "go",
		sourceDirs: existingDirs(cwd, SOURCE_DIR_CANDIDATES),
		testDirs: existingDirs(cwd, TEST_DIR_CANDIDATES),
		commands: { test: "go test ./...", build: "go build ./..." },
	};
}

/**
 * Detect a project profile from the filesystem. Always resolves (never rejects):
 * an unrecognized project degrades to a minimal `unknown` profile.
 */
export function detectProfile(cwd: string): Promise<ProjectProfile> {
	const detected = detectNode(cwd) ?? detectPython(cwd) ?? detectGo(cwd);
	if (detected) {
		return Promise.resolve(detected);
	}
	return Promise.resolve({
		language: "unknown",
		packageManager: "unknown",
		sourceDirs: existingDirs(cwd, SOURCE_DIR_CANDIDATES),
		testDirs: existingDirs(cwd, TEST_DIR_CANDIDATES),
		commands: {},
	});
}

/** Persist to `.agent/project-profile.json`. Returns validation errors ([] on success). */
export function saveProfile(cwd: string, profile: ProjectProfile): string[] {
	return writeProfile(cwd, profile);
}

/** Load the persisted profile, or undefined if absent/invalid. */
export function loadProfile(cwd: string): ProjectProfile | undefined {
	return loadAgentConfig(cwd).profile ?? undefined;
}

/** Render the profile as a system-prompt block with the fields the agent needs. */
export function renderProfileForPrompt(p: ProjectProfile): string {
	const lines = [
		"# Project profile (auto-detected)",
		`- Language: ${p.language}`,
		`- Package manager: ${p.packageManager}`,
	];
	if (p.framework) lines.push(`- Framework: ${p.framework}`);
	if (p.testFramework) lines.push(`- Test framework: ${p.testFramework}`);
	if (p.sourceDirs.length) lines.push(`- Source dirs: ${p.sourceDirs.join(", ")}`);
	if (p.testDirs.length) lines.push(`- Test dirs: ${p.testDirs.join(", ")}`);
	const cmds = Object.entries(p.commands)
		.filter((entry): entry is [string, string] => Boolean(entry[1]))
		.map(([k, v]) => `${k}=${v}`);
	if (cmds.length) lines.push(`- Commands: ${cmds.join(", ")}`);
	return lines.join("\n");
}
