import { basename } from "node:path";
import type { ProjectProfile } from "../config/schema.ts";

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegex(value: string): string {
	return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
	let pattern = normalizePath(glob.trim());
	if (pattern.endsWith("/")) {
		pattern += "**";
	}
	let source = "";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		const next = pattern[i + 1];
		if (char === "*" && next === "*") {
			source += ".*";
			i++;
		} else if (char === "*") {
			source += "[^/]*";
		} else if (char === "?") {
			source += "[^/]";
		} else {
			source += escapeRegex(char ?? "");
		}
	}
	return new RegExp(`^(?:${source})$`, "i");
}

function matchesAny(path: string, patterns: string[]): boolean {
	const normalized = normalizePath(path);
	const candidates = [normalized, basename(normalized)];
	return patterns.some((pattern) => globToRegex(pattern).test(normalized) || candidates.some((c) => globToRegex(pattern).test(c)));
}

export function isTestFile(path: string, profile?: ProjectProfile): boolean {
	const normalized = normalizePath(path);
	const configuredDirs = profile?.testDirs ?? [];
	if (configuredDirs.some((dir) => normalized === normalizePath(dir) || normalized.startsWith(`${normalizePath(dir)}/`))) {
		return true;
	}
	return matchesAny(normalized, [
		"**/*.test.ts",
		"**/*.test.tsx",
		"**/*.test.js",
		"**/*.test.jsx",
		"**/*.spec.ts",
		"**/*.spec.tsx",
		"**/*.spec.js",
		"**/*.spec.jsx",
		"test/**",
		"tests/**",
		"__tests__/**",
		"spec/**",
		"specs/**",
	]);
}

export function isTestFixGoal(goal: string): boolean {
	return /(fix|repair|debug|make .*test.*pass|修复|修好|让.*测试.*通过|测试.*失败)/i.test(goal);
}

export function allowsTestWrites(goal: string): boolean {
	return /(add|write|create|update|补|新增|编写).{0,16}(test|spec|测试|用例)/i.test(goal);
}

