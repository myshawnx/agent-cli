import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		// Headless tests drive a faux provider; no real network calls are made.
		testTimeout: 20_000,
	},
});
