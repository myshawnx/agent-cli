import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

export function applyCommandTimeout(event: ToolCallEvent, commandTimeoutMs: number | undefined): void {
	if (event.toolName !== "bash" || !commandTimeoutMs) {
		return;
	}
	const input = event.input as Record<string, unknown>;
	const current = typeof input.timeout === "number" ? input.timeout : undefined;
	if (!current || current > commandTimeoutMs) {
		input.timeout = commandTimeoutMs;
	}
}

