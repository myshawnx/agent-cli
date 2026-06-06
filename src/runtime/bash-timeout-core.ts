import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

export function commandTimeoutSeconds(commandTimeoutMs: number | undefined): number | undefined {
	if (!commandTimeoutMs || commandTimeoutMs <= 0) {
		return undefined;
	}
	return Math.ceil(commandTimeoutMs / 1000);
}

export function applyCommandTimeout(event: ToolCallEvent, commandTimeoutMs: number | undefined): void {
	if (event.toolName !== "bash" || !commandTimeoutMs) {
		return;
	}
	const input = event.input as Record<string, unknown>;
	const current = typeof input.timeout === "number" ? input.timeout : undefined;
	const timeoutSeconds = commandTimeoutSeconds(commandTimeoutMs);
	if (timeoutSeconds && (!current || current > timeoutSeconds)) {
		input.timeout = timeoutSeconds;
	}
}

export async function withCommandTimeout<T>(
	commandTimeoutMs: number | undefined,
	parentSignal: AbortSignal | undefined,
	run: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
	if (!commandTimeoutMs || commandTimeoutMs <= 0) {
		return run(parentSignal);
	}
	const controller = new AbortController();
	let timedOut = false;
	let settled = false;
	const abort = () => {
		if (!settled) {
			controller.abort();
		}
	};
	const timeout = setTimeout(() => {
		timedOut = true;
		abort();
	}, commandTimeoutMs);
	if (parentSignal?.aborted) {
		abort();
	}
	parentSignal?.addEventListener("abort", abort, { once: true });
	try {
		return await run(controller.signal);
	} catch (err) {
		if (timedOut) {
			const seconds = commandTimeoutSeconds(commandTimeoutMs) ?? Math.ceil(commandTimeoutMs / 1000);
			throw new Error(`Command timed out after ${seconds} seconds`);
		}
		throw err;
	} finally {
		settled = true;
		clearTimeout(timeout);
		parentSignal?.removeEventListener("abort", abort);
	}
}
