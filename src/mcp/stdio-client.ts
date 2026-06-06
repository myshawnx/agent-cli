import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { type Interface, createInterface } from "node:readline";
import type { McpServerConfig, McpToolInfo } from "./types.ts";

interface JsonRpcResponse<T = unknown> {
	id?: number;
	result?: T;
	error?: { code?: number; message?: string };
}

interface PendingRequest {
	resolve: (response: JsonRpcResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "agent-cli", version: "1.0.0" };

/** Piped child stdio are net.Socket at runtime (have `unref`), but typed as Writable/Readable. */
function unrefStream(stream: unknown): void {
	(stream as { unref?: () => void }).unref?.();
}

/**
 * Process-exit safety net. The print path (`agent -p`) tears a session down with a
 * bare `session.dispose()`, which does NOT emit `session_shutdown` — so the adapter
 * never gets a chance to dispose its clients there. Every live child is unref'd (it
 * can never hold the event loop open) and registered here so a single `exit` hook can
 * synchronously reap any survivor and avoid orphaned MCP processes.
 */
const liveChildren = new Set<ChildProcessWithoutNullStreams>();
let exitHookInstalled = false;
function installExitHook(): void {
	if (exitHookInstalled) {
		return;
	}
	exitHookInstalled = true;
	process.once("exit", () => {
		for (const child of liveChildren) {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill();
			}
		}
	});
}

/**
 * A persistent stdio MCP connection. The child process is spawned once and the
 * `initialize` handshake runs once; `listTools()` and `callTool()` reuse the same
 * connection, routing JSON-RPC responses back to their request by `id`.
 *
 * Lifecycle is owned by the adapter: `start()` on session start, `dispose()` on
 * session shutdown. Per-request timeout and `AbortSignal` are preserved; an aborted
 * call rejects but leaves the connection alive for reuse (the connection is shared
 * across tools, so abort must not tear it down). A crash/early-exit rejects all
 * in-flight requests and fires `onClose`, so the loop can never hang on a dead server.
 */
export class McpStdioClient {
	private nextId = 1;
	private child?: ChildProcessWithoutNullStreams;
	private lines?: Interface;
	private readonly pending = new Map<number, PendingRequest>();
	private startPromise?: Promise<void>;
	private closed = false;
	private closeError?: Error;
	private onClose?: (error: Error) => void;

	constructor(
		private readonly serverName: string,
		private readonly config: McpServerConfig,
		private readonly cwd: string,
		private readonly requestTimeoutMs = 120_000,
	) {}

	/** Register a one-shot callback fired when the connection closes unexpectedly (crash/early exit). */
	setOnClose(handler: (error: Error) => void): void {
		this.onClose = handler;
	}

	/** Spawn the child and run the `initialize` handshake. Idempotent: repeat calls await the first. */
	start(): Promise<void> {
		if (!this.startPromise) {
			this.startPromise = this.doStart();
		}
		return this.startPromise;
	}

	private async doStart(): Promise<void> {
		installExitHook();
		const child = spawn(this.config.command, this.config.args ?? [], {
			cwd: this.cwd,
			env: { ...process.env, ...(this.config.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		liveChildren.add(child);
		// An idle persistent connection must never keep a print-mode process alive after
		// session.dispose(). During an in-flight request the ref'd per-request timer holds
		// the loop open instead, so responses are still delivered.
		child.unref();
		unrefStream(child.stdin);
		unrefStream(child.stdout);
		unrefStream(child.stderr);

		this.lines = createInterface({ input: child.stdout });
		this.lines.on("line", (line) => this.handleLine(line));
		child.once("error", (err) => {
			this.handleUnexpectedClose(new Error(`MCP ${this.serverName}: ${err.message}`));
		});
		child.once("exit", (code, signal) => {
			this.handleUnexpectedClose(
				new Error(`MCP ${this.serverName}: server exited before responding (${signal ?? code ?? "unknown"})`),
			);
		});

		await this.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: CLIENT_INFO,
		});
	}

	private handleLine(line: string): void {
		let response: JsonRpcResponse;
		try {
			response = JSON.parse(line) as JsonRpcResponse;
		} catch {
			return; // Ignore non-JSON log lines from servers.
		}
		if (typeof response.id !== "number") {
			return;
		}
		const request = this.pending.get(response.id);
		if (!request) {
			return; // Late response for an aborted/timed-out request.
		}
		clearTimeout(request.timer);
		this.pending.delete(response.id);
		request.resolve(response);
	}

	private settleClosed(error: Error): void {
		this.closed = true;
		this.closeError = error;
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		this.pending.clear();
		if (this.child) {
			liveChildren.delete(this.child);
		}
		this.lines?.close();
	}

	private handleUnexpectedClose(error: Error): void {
		if (this.closed) {
			return;
		}
		this.settleClosed(error);
		this.onClose?.(error);
	}

	private request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
		if (this.closed) {
			return Promise.reject(this.closeError ?? new Error(`MCP ${this.serverName}: connection closed`));
		}
		if (signal?.aborted) {
			return Promise.reject(new Error(`MCP ${this.serverName}: aborted`));
		}
		const child = this.child;
		if (!child) {
			return Promise.reject(new Error(`MCP ${this.serverName}: not started`));
		}

		const id = this.nextId++;
		const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
		const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP ${this.serverName}.${method}: timed out after ${this.requestTimeoutMs}ms`));
			}, this.requestTimeoutMs);
			const onAbort = (): void => {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(new Error(`MCP ${this.serverName}: aborted`));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, {
				resolve: (response) => {
					signal?.removeEventListener("abort", onAbort);
					resolve(response);
				},
				reject: (err) => {
					signal?.removeEventListener("abort", onAbort);
					reject(err);
				},
				timer,
			});
			child.stdin.write(`${payload}\n`);
		});

		return promise.then((response) => {
			if (response.error) {
				throw new Error(
					`MCP ${this.serverName}.${method}: ${response.error.message ?? response.error.code ?? "error"}`,
				);
			}
			return response.result;
		});
	}

	async listTools(): Promise<McpToolInfo[]> {
		await this.start();
		const result = (await this.request("tools/list", {})) as {
			tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
		};
		return (result.tools ?? []).map((tool) => ({
			server: this.serverName,
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		}));
	}

	async callTool(name: string, arguments_: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		await this.start();
		return this.request("tools/call", { name, arguments: arguments_ }, signal);
	}

	/** Tear the connection down. Caller-initiated, so it does not fire `onClose`. */
	dispose(): void {
		const child = this.child;
		if (!this.closed) {
			this.settleClosed(new Error(`MCP ${this.serverName}: disposed`));
		}
		if (child && child.exitCode === null && child.signalCode === null) {
			child.stdin.end();
			child.kill();
		}
	}
}
