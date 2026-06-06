import { type ExtensionFactory, defineTool, truncateTail } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadMcpConfig } from "./config.ts";
import { toTypeBox } from "./schema-map.ts";
import { McpStdioClient } from "./stdio-client.ts";

function safeToolName(server: string, tool: string): string {
	return `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
}

function resultText(result: unknown): string {
	if (typeof result === "string") {
		return result;
	}
	return JSON.stringify(result, null, 2);
}

function hasTopLevelObjectSchema(schema: unknown): boolean {
	return typeof schema === "object" && schema !== null && (schema as { type?: unknown }).type === "object";
}

function normalizeToolArguments(params: unknown): Record<string, unknown> {
	return typeof params === "object" && params !== null && !Array.isArray(params) ? { ...params } : {};
}

export function mcpAdapter(cwd: string, requestTimeoutMs = 120_000): ExtensionFactory {
	return (pi) => {
		const clients = new Set<McpStdioClient>();

		const disposeAll = (): void => {
			for (const client of clients) {
				client.dispose();
			}
			clients.clear();
		};

		pi.on("session_shutdown", () => {
			disposeAll();
		});

		pi.on("session_start", async () => {
			const config = loadMcpConfig(cwd);
			for (const [serverName, server] of Object.entries(config.servers)) {
				const client = new McpStdioClient(serverName, server, cwd, requestTimeoutMs);
				let tools: Awaited<ReturnType<McpStdioClient["listTools"]>> = [];
				try {
					tools = await client.listTools();
				} catch (err) {
					pi.appendEntry("mcp-error", {
						server: serverName,
						message: err instanceof Error ? err.message : String(err),
					});
					client.dispose();
					continue;
				}
				clients.add(client);

				const toolNames = tools.map((tool) => safeToolName(serverName, tool.name));
				client.setOnClose((error) => {
					clients.delete(client);
					pi.appendEntry("mcp-error", { server: serverName, message: error.message });
					try {
						const active = pi.getActiveTools();
						const remaining = active.filter((name) => !toolNames.includes(name));
						if (remaining.length !== active.length) {
							pi.setActiveTools(remaining);
						}
					} catch {
						// Best-effort cleanup only; session shutdown/reload may make the runtime stale.
					}
				});

				for (const tool of tools) {
					const toolName = safeToolName(serverName, tool.name);
					pi.registerTool(
						defineTool({
							name: toolName,
							label: `mcp:${serverName}/${tool.name}`,
							description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
							promptSnippet: `MCP ${serverName}/${tool.name}`,
							parameters: hasTopLevelObjectSchema(tool.inputSchema)
								? toTypeBox(tool.inputSchema)
								: Type.Record(Type.String(), Type.Any()),
							async execute(_toolCallId, params, signal) {
								try {
									const result = await client.callTool(tool.name, normalizeToolArguments(params), signal);
									const text = truncateTail(resultText(result), { maxBytes: 8_000 }).content;
									pi.appendEntry("mcp-tool-call", { server: serverName, tool: tool.name });
									return { content: [{ type: "text", text }], details: result };
								} catch (err) {
									pi.appendEntry("mcp-error", {
										server: serverName,
										tool: tool.name,
										message: err instanceof Error ? err.message : String(err),
									});
									throw err;
								}
							},
						}),
					);
				}

				const active = pi.getActiveTools();
				pi.setActiveTools([...new Set([...active, ...toolNames])]);
			}
		});
	};
}
