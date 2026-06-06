import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpStdioClient } from "../../src/mcp/stdio-client.ts";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const STUB_SERVER = join(FIXTURES_DIR, "stub-server.mjs");

function makeClient(name: string, env: Record<string, string>, timeoutMs = 5_000): McpStdioClient {
	return new McpStdioClient(name, { command: process.execPath, args: [STUB_SERVER], env }, process.cwd(), timeoutMs);
}

/** A temp file the stub server appends its pid to on each spawn (see fixtures/stub-server.mjs). */
function freshSpawnLog(): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "mcp-spawn-"));
	return { dir, file: join(dir, "spawns.log") };
}

function readPids(logFile: string): number[] {
	if (!existsSync(logFile)) {
		return [];
	}
	return readFileSync(logFile, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => Number(line));
}

/** Reads the single pid a stub server is expected to have logged; throws if absent. */
function readSinglePid(logFile: string): number {
	const pid = readPids(logFile)[0];
	if (pid === undefined) {
		throw new Error(`no pid recorded in ${logFile}`);
	}
	return pid;
}

/** `process.kill(pid, 0)` probes existence: ESRCH means the process is gone. */
function processGone(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "ESRCH";
	}
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("waitFor: condition not met before timeout");
}

describe("McpStdioClient", () => {
	it("reuses a single child process across listTools and callTool (no respawn)", async () => {
		const { dir, file } = freshSpawnLog();
		const client = makeClient("reuse-server", { MCP_TEST_MODE: "echo", MCP_SPAWN_LOG: file });
		try {
			const tools = await client.listTools();
			expect(tools.map((tool) => tool.name)).toContain("echo");

			const result = await client.callTool("echo", { message: "hello" });
			expect(result).toBeDefined();

			// initialize + tools/list + tools/call must all ride one persistent connection.
			expect(readPids(file)).toHaveLength(1);
		} finally {
			client.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects when a server never responds before the request timeout", async () => {
		const client = makeClient("timeout-server", { MCP_TEST_MODE: "timeout" }, 150);
		try {
			await expect(client.listTools()).rejects.toThrow("timed out after 150ms");
		} finally {
			client.dispose();
		}
	});

	it("aborts an in-flight tool call without tearing down the reusable connection", async () => {
		const { dir, file } = freshSpawnLog();
		const controller = new AbortController();
		const client = makeClient("abort-server", { MCP_TEST_MODE: "call-timeout", MCP_SPAWN_LOG: file });
		try {
			const request = client.callTool("echo", { message: "hello" }, controller.signal);
			setTimeout(() => controller.abort(), 50);
			await expect(request).rejects.toThrow("aborted");

			// Abort cancels the request only; the shared connection stays alive for other tools.
			const pid = readSinglePid(file);
			expect(pid).toBeGreaterThan(0);
			expect(processGone(pid)).toBe(false);
		} finally {
			client.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects an in-flight call when the server crashes instead of hanging", async () => {
		const client = makeClient("crash-server", { MCP_TEST_MODE: "crash-on-call" });
		const closes: Error[] = [];
		client.setOnClose((error) => closes.push(error));
		try {
			await client.listTools();
			await expect(client.callTool("echo", { message: "boom" })).rejects.toThrow(/exited before responding/);
			expect(closes).toHaveLength(1);
		} finally {
			client.dispose();
		}
	});

	it("kills the child process on dispose and rejects later calls", async () => {
		const { dir, file } = freshSpawnLog();
		const client = makeClient("dispose-server", { MCP_TEST_MODE: "echo", MCP_SPAWN_LOG: file });
		try {
			await client.listTools();
			const pid = readSinglePid(file);
			expect(pid).toBeGreaterThan(0);
			expect(processGone(pid)).toBe(false);

			client.dispose();
			await waitFor(() => processGone(pid));

			await expect(client.callTool("echo", {})).rejects.toThrow(/disposed/);
		} finally {
			client.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
