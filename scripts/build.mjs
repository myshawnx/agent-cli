import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const external = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui"];

async function buildWithEsbuild() {
	const { build } = await import("esbuild");
	await build({
		entryPoints: ["src/main.ts"],
		outfile: "dist/cli.js",
		platform: "node",
		format: "esm",
		target: "node22",
		bundle: true,
		sourcemap: true,
		banner: {
			js: [
				"#!/usr/bin/env node",
				'import { createRequire as __agentCreateRequire } from "node:module";',
				"const require = __agentCreateRequire(import.meta.url);",
			].join("\n"),
		},
		external,
	});
}

function walkTsFiles(dir, out = []) {
	for (const entry of ts.sys.readDirectory(dir, [".ts"], ["node_modules", "dist"], ["**/*.ts"])) {
		out.push(entry.replace(/\\/g, "/"));
	}
	return out;
}

function rewriteTsSpecifiers(source) {
	return source
		.replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2")
		.replace(/(import\(["'][^"']+)\.ts(["']\))/g, "$1.js$2");
}

function emitFallback() {
	const files = walkTsFiles("src");
	for (const file of files) {
		const source = rewriteTsSpecifiers(readFileSync(file, "utf8"));
		const output = ts.transpileModule(source, {
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.ESNext,
				moduleResolution: ts.ModuleResolutionKind.Bundler,
				verbatimModuleSyntax: true,
			},
			fileName: file,
		}).outputText;
		const relativePath = relative("src", file).replace(/\\/g, "/").replace(/\.ts$/, ".js");
		const target = relativePath === "main.js" ? "dist/cli.js" : resolve("dist", relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${relativePath === "main.js" ? "#!/usr/bin/env node\n" : ""}${output}`, "utf8");
	}
}

try {
	await buildWithEsbuild();
	console.log("built dist/cli.js");
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	console.warn(`esbuild failed (${message}); falling back to TypeScript transpile output`);
	emitFallback();
	console.log("built dist/cli.js (fallback)");
}
