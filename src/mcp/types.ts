export interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpConfig {
	servers: Record<string, McpServerConfig>;
}

export interface McpToolInfo {
	server: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
}
