#!/usr/bin/env node
/**
 * Dedupe the nested `@earendil-works/pi-ai` copy.
 *
 * `@earendil-works/pi-coding-agent` declares `@earendil-works/pi-ai` as a normal
 * dependency and npm installs a SECOND physical copy under
 * `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai`,
 * even when it is byte-for-byte the same version as the hoisted top-level copy
 * (npm refuses to collapse an already-shaped tree, and `overrides` only constrains
 * the version, not the hoisting).
 *
 * Two physical copies of pi-ai = two ES module instances = two independent
 * `api-registry` singletons. Our headless tests call `registerFauxProvider()` from
 * the TOP-LEVEL pi-ai, but the agent loop inside pi-coding-agent resolves providers
 * through its NESTED pi-ai. The faux provider is therefore invisible to the loop and
 * every faux-driven turn dies with:
 *
 *     stopReason: "error"
 *     errorMessage: "No API provider registered for api: faux:…"
 *
 * which silently breaks every faux integration test that drives a real tool call.
 *
 * Fix: if the nested copy is the SAME version as the hoisted one, delete it so Node
 * resolves pi-coding-agent's `import "@earendil-works/pi-ai"` to the single hoisted
 * instance. If the versions differ we leave it alone and warn — that is a real
 * version skew the maintainer must resolve deliberately (e.g. bump the lockfile),
 * not something to paper over.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

const topPkg = join(repoRoot, "node_modules", "@earendil-works", "pi-ai", "package.json");
const nestedDir = join(
	repoRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
);
const nestedPkg = join(nestedDir, "package.json");

function version(pkgPath) {
	try {
		return JSON.parse(readFileSync(pkgPath, "utf8")).version;
	} catch {
		return undefined;
	}
}

if (!existsSync(nestedPkg)) {
	// Nothing nested — already deduped.
	process.exit(0);
}

const topVersion = version(topPkg);
const nestedVersion = version(nestedPkg);

if (!topVersion) {
	console.warn("[dedupe-pi-ai] top-level @earendil-works/pi-ai not found; leaving nested copy in place.");
	process.exit(0);
}

if (topVersion !== nestedVersion) {
	console.warn(
		`[dedupe-pi-ai] version skew: top-level pi-ai is ${topVersion} but pi-coding-agent's nested copy is ${nestedVersion}. Not removing the nested copy — resolve the version mismatch in package.json/package-lock.json first.`,
	);
	process.exit(0);
}

rmSync(nestedDir, { recursive: true, force: true });
console.log(
	`[dedupe-pi-ai] removed redundant nested @earendil-works/pi-ai@${nestedVersion} so the faux api-registry is shared with the agent loop.`,
);
