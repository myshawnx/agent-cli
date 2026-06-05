import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import type { McpServerConfig, McpToolInfo } from "./types.ts";

interface JsonRpcResponse<T = unknown> {
	id?: number;
	result?: T;
	error?: { code?: number; message?: string };
}

export class McpStdioClient {
	private nextId = 1;

	constructor(
		private readonly serverName: string,
		private readonly config: McpServerConfig,
		private readonly cwd: string,
	) {}

	private async withProcess<T>(fn: (request: (method: string, params?: unknown) => Promise<unknown>) => Promise<T>): Promise<T> {
		const child = spawn(this.config.command, this.config.args ?? [], {
			cwd: this.cwd,
			env: { ...process.env, ...(this.config.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const pending = new Map<number, (response: JsonRpcResponse) => void>();
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			try {
				const response = JSON.parse(line) as JsonRpcResponse;
				if (typeof response.id === "number") {
					pending.get(response.id)?.(response);
					pending.delete(response.id);
				}
			} catch {
				// Ignore non-JSON log lines from servers.
			}
		});

		const request = async (method: string, params?: unknown): Promise<unknown> => {
			const id = this.nextId++;
			const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
			const promise = new Promise<JsonRpcResponse>((resolve) => pending.set(id, resolve));
			child.stdin.write(`${payload}\n`);
			const response = await promise;
			if (response.error) {
				throw new Error(`MCP ${this.serverName}.${method}: ${response.error.message ?? response.error.code ?? "error"}`);
			}
			return response.result;
		};

		try {
			return await fn(request);
		} finally {
			child.stdin.end();
			child.kill();
			await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 100))]);
		}
	}

	async listTools(): Promise<McpToolInfo[]> {
		return this.withProcess(async (request) => {
			await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agent-cli", version: "1.0.0" } });
			const result = (await request("tools/list", {})) as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
			return (result.tools ?? []).map((tool) => ({ server: this.serverName, name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
		});
	}

	async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
		return this.withProcess(async (request) => {
			await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agent-cli", version: "1.0.0" } });
			return request("tools/call", { name, arguments: arguments_ });
		});
	}
}

