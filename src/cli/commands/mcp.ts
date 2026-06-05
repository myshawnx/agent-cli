import { loadMcpConfig, mcpConfigPath, removeMcpServer, upsertMcpServer } from "../../mcp/config.ts";

export type McpAction = "list" | "add" | "remove";

export interface McpOptions {
	cwd: string;
	action: McpAction;
	name?: string;
	command?: string;
	args?: string;
}

function parseArgs(value: string | undefined): string[] | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	return value.match(/"([^"]*)"|'([^']*)'|(\S+)/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) ?? [];
}

export async function runMcp(opts: McpOptions): Promise<number> {
	if (opts.action === "list") {
		const config = loadMcpConfig(opts.cwd);
		const entries = Object.entries(config.servers);
		if (entries.length === 0) {
			process.stdout.write(`No MCP servers configured (${mcpConfigPath(opts.cwd)}).\n`);
			return 0;
		}
		process.stdout.write("# MCP Servers\n\n");
		for (const [name, server] of entries) {
			process.stdout.write(`- ${name}: ${server.command} ${(server.args ?? []).join(" ")}\n`);
		}
		return 0;
	}

	if (!opts.name) {
		process.stderr.write("usage: agent mcp add/remove <name>\n");
		return 1;
	}

	if (opts.action === "remove") {
		const existed = removeMcpServer(opts.cwd, opts.name);
		process.stdout.write(existed ? `Removed MCP server ${opts.name}.\n` : `MCP server ${opts.name} was not configured.\n`);
		return 0;
	}

	if (!opts.command) {
		process.stderr.write('usage: agent mcp add <name> --command <cmd> [--args "..."]\n');
		return 1;
	}
	upsertMcpServer(opts.cwd, opts.name, { command: opts.command, args: parseArgs(opts.args) });
	process.stdout.write(`Configured MCP server ${opts.name} in ${mcpConfigPath(opts.cwd)}.\n`);
	return 0;
}

