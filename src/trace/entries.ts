import type { ExtensionFactory, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { targetPath } from "../policy/path-guard.ts";
import type { TaskResultEntry } from "./types.ts";

export interface TraceRecorderOptions {
	goal?: string;
	mode: string;
}

function isWriteLike(event: ToolCallEvent): boolean {
	return event.toolName === "write" || event.toolName === "edit" || event.toolName === "apply_patch";
}

export function traceRecorder(options: TraceRecorderOptions): ExtensionFactory {
	return (pi) => {
		let turns = 0;
		let toolCalls = 0;
		const modifiedFiles = new Set<string>();

		pi.on("agent_start", () => {
			turns = 0;
			toolCalls = 0;
			modifiedFiles.clear();
			pi.appendEntry("task-meta", {
				goal: options.goal ?? "",
				mode: options.mode,
				startedAt: new Date().toISOString(),
			});
		});

		pi.on("turn_end", () => {
			turns++;
		});

		pi.on("tool_call", (event) => {
			toolCalls++;
			pi.appendEntry("task-tool-call", { tool: event.toolName, input: event.input });
			if (isWriteLike(event)) {
				const path = targetPath(event.input);
				if (path) {
					modifiedFiles.add(path);
					pi.appendEntry("task-modified-file", { path, tool: event.toolName });
				}
			}
		});

		pi.on("agent_end", () => {
			const result: TaskResultEntry = {
				status: "completed",
				endedAt: new Date().toISOString(),
				turns,
				toolCalls,
				modifiedFiles: [...modifiedFiles],
			};
			pi.appendEntry("task-result", result);
		});
	};
}

