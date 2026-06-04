import { build } from "esbuild";

// Bundle the CLI into a single executable file with a node shebang.
// The pi packages are kept external (resolved from node_modules at runtime),
// matching the "use pi as a library" design: we never fork or inline pi.
await build({
	entryPoints: ["src/main.ts"],
	outfile: "dist/cli.js",
	platform: "node",
	format: "esm",
	target: "node22",
	bundle: true,
	sourcemap: true,
	banner: { js: "#!/usr/bin/env node" },
	external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui"],
});

console.log("built dist/cli.js");
