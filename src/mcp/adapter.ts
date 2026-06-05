import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadMcpConfig } from "./config.ts";
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

export function mcpAdapter(cwd: string): ExtensionFactory {
	return (pi) => {
		pi.on("session_start", async () => {
			const config = loadMcpConfig(cwd);
			for (const [serverName, server] of Object.entries(config.servers)) {
				const client = new McpStdioClient(serverName, server, cwd);
				let tools: Awaited<ReturnType<McpStdioClient["listTools"]>> = [];
				try {
					tools = await client.listTools();
				} catch (err) {
					pi.appendEntry("mcp-error", { server: serverName, message: err instanceof Error ? err.message : String(err) });
					continue;
				}
				for (const tool of tools) {
					pi.registerTool(
						defineTool({
							name: safeToolName(serverName, tool.name),
							label: `mcp:${serverName}/${tool.name}`,
							description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
							promptSnippet: `MCP ${serverName}/${tool.name}`,
							parameters: Type.Record(Type.String(), Type.Any()),
							async execute(_toolCallId, params) {
								const result = await new McpStdioClient(serverName, server, cwd).callTool(tool.name, params);
								pi.appendEntry("mcp-tool-call", { server: serverName, tool: tool.name });
								return { content: [{ type: "text", text: resultText(result) }], details: result };
							},
						}),
					);
				}
			}
		});
	};
}

