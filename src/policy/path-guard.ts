/**
 * Path guard helpers.
 *
 * These helpers protect pi's file tools and provide a best-effort bash path speed
 * bump. They are deliberately conservative and small: good enough to catch common
 * accidents/obvious adversarial strings, not a complete shell parser. True read/write
 * isolation belongs to the optional sandbox layer documented in C2/C6.
 */

import { basename, isAbsolute, relative, resolve } from "node:path";
import type { PolicyConfig } from "./types.ts";

function normalizePathLike(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function escapeRegex(s: string): string {
	return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
	let p = normalizePathLike(pattern.trim());
	if (p.endsWith("/")) {
		p += "**";
	}
	let out = "";
	for (let i = 0; i < p.length; i++) {
		const ch = p[i];
		const next = p[i + 1];
		if (ch === "*" && next === "*") {
			const after = p[i + 2];
			if (after === "/" || after === "\\") {
				out += "(.*\\/)?";
				i += 2; // skip **/ or **\
			} else {
				out += ".*";
				i++;
			}
		} else if (ch === "*") {
			out += "[^/]*";
		} else if (ch === "?") {
			out += "[^/]";
		} else {
			out += escapeRegex(ch ?? "");
		}
	}
	return new RegExp(`^(?:${out})$`, "i");
}

function candidateVariants(path: string): string[] {
	const normalized = normalizePathLike(path);
	const withoutDrive = normalized.replace(/^[A-Za-z]:\//, "");
	const noLeadingSlash = withoutDrive.replace(/^\/+/, "");
	return [...new Set([normalized, withoutDrive, noLeadingSlash, basename(normalized)])].filter(Boolean);
}

function matchesGlob(path: string, patterns: string[]): boolean {
	const variants = candidateVariants(path);
	return patterns.some((pattern) => {
		if (!pattern.trim()) {
			return false;
		}
		const regex = globToRegex(pattern);
		return variants.some((candidate) => regex.test(candidate));
	});
}

export function pathDenied(p: string, cfg: PolicyConfig["path"]): boolean {
	return matchesGlob(p, cfg.deny);
}

export function pathConfirmWrite(p: string, cfg: PolicyConfig["path"]): boolean {
	return matchesGlob(p, cfg.confirmWrite);
}

/** Resolve a target path against repoRoot and detect if it escapes that root. */
export function outsideRepoRoot(p: string, repoRoot: string): boolean {
	const trimmed = p.trim();
	if (!trimmed) {
		return false;
	}
	if (trimmed.startsWith("~")) {
		return true;
	}
	const root = resolve(repoRoot);
	const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed);
	const rel = relative(root, abs);
	return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel);
}

function stringProp(input: unknown, names: string[]): string | undefined {
	if (!input || typeof input !== "object") {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	for (const name of names) {
		const value = record[name];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}
	return undefined;
}

/** Extract the primary target path from pi built-in tool inputs. */
export function targetPath(input: unknown): string | undefined {
	return stringProp(input, ["path", "file", "filepath", "filePath"]);
}

function bashTokens(command: string): string[] {
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match = re.exec(command);
	while (match !== null) {
		tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
		match = re.exec(command);
	}
	return tokens;
}

function looksLikePath(token: string): boolean {
	return (
		token.startsWith(".") ||
		token.startsWith("/") ||
		token.startsWith("~") ||
		token.includes("/") ||
		token.includes("\\") ||
		/^\.env(?:\b|$)/.test(token) ||
		token.startsWith(".git") ||
		/\.(pem|key|crt|env)$/i.test(token) ||
		/credentials/i.test(token)
	);
}

function candidateProtectedPath(path: string, cfg: PolicyConfig["path"]): boolean {
	return pathDenied(path, cfg) || path.startsWith("~/.ssh") || path.includes("/.ssh/");
}

/**
 * Best-effort bash path detector. Covers common redirection/tee/cp/mv/cat patterns
 * and sensitive-looking path arguments; does NOT parse nested shells, variables,
 * base64 payloads, or arbitrary shell grammar.
 */
export function bashTouchesProtectedPath(command: string, cfg: PolicyConfig["path"]): boolean {
	const normalized = command.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return false;
	}

	for (const match of normalized.matchAll(/(?:^|\s)(?:>|>>|2>|&>)\s*([^\s;&|]+)/g)) {
		if (candidateProtectedPath(stripShellToken(match[1] ?? ""), cfg)) {
			return true;
		}
	}

	const tokens = bashTokens(normalized).map(stripShellToken).filter(Boolean);
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i] ?? "";
		if ((t === "tee" || t === "cp" || t === "mv") && tokens.slice(i + 1).some((x) => candidateProtectedPath(x, cfg))) {
			return true;
		}
		if (
			(t === "cat" || t === "grep" || t === "find" || t === "ls") &&
			tokens.slice(i + 1).some((x) => candidateProtectedPath(x, cfg))
		) {
			return true;
		}
		if (looksLikePath(t) && candidateProtectedPath(t, cfg)) {
			return true;
		}
	}
	return false;
}

function stripShellToken(token: string): string {
	return token
		.replace(/^['"]|['"]$/g, "")
		.replace(/[;,]$/g, "")
		.trim();
}
