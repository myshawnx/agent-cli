import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpConfig, McpServerConfig } from "./types.ts";

export const EMPTY_MCP_CONFIG: McpConfig = { servers: {} };

export function mcpConfigPath(cwd: string): string {
	return join(cwd, ".agent", "mcp.json");
}

export function loadMcpConfig(cwd: string): McpConfig {
	const path = mcpConfigPath(cwd);
	if (!existsSync(path)) {
		return structuredClone(EMPTY_MCP_CONFIG);
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<McpConfig>;
		return { servers: parsed.servers ?? {} };
	} catch {
		return structuredClone(EMPTY_MCP_CONFIG);
	}
}

export function saveMcpConfig(cwd: string, config: McpConfig): void {
	const path = mcpConfigPath(cwd);
	mkdirSync(join(cwd, ".agent"), { recursive: true });
	writeFileSync(path, JSON.stringify(config, null, "\t"), "utf8");
}

export function upsertMcpServer(cwd: string, name: string, server: McpServerConfig): McpConfig {
	const config = loadMcpConfig(cwd);
	config.servers[name] = server;
	saveMcpConfig(cwd, config);
	return config;
}

export function removeMcpServer(cwd: string, name: string): boolean {
	const config = loadMcpConfig(cwd);
	const existed = name in config.servers;
	delete config.servers[name];
	saveMcpConfig(cwd, config);
	return existed;
}
