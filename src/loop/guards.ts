import type { ExtensionFactory, ToolCallEvent, ToolCallEventResult, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { targetPath } from "../policy/path-guard.ts";
import { createFailureSignature } from "./failure-signature.ts";
import { allowsTestWrites, isTestFile, isTestFixGoal } from "./test-file.ts";
import type { LoopGuardOptions, LoopGuardState } from "./types.ts";

function block(reason: string): ToolCallEventResult {
	return { block: true, reason };
}

function isWriteTool(event: ToolCallEvent): boolean {
	return event.toolName === "edit" || event.toolName === "write" || event.toolName === "apply_patch";
}

function bashLooksLikeTest(command: string): boolean {
	return /\b(test|vitest|jest|pytest|go test|cargo test|npm test|pnpm test|yarn test)\b/i.test(command);
}

function commandFrom(event: ToolCallEvent): string {
	const command = (event.input as Record<string, unknown>).command;
	return typeof command === "string" ? command : "";
}

function appendGuardEntry(pi: Parameters<ExtensionFactory>[0], kind: string, data: Record<string, unknown>): void {
	pi.appendEntry("loop-guard", { kind, ...data });
}

function sendSoftStop(pi: Parameters<ExtensionFactory>[0], reason: string): void {
	pi.sendMessage(
		{
			customType: "loop-guard-stop",
			content: `Loop guard soft-stop: ${reason}\nPreserve the current diff and summarize failures instead of continuing to iterate.`,
			display: true,
			details: { reason },
		},
		{ deliverAs: "followUp" },
	);
}

export function loopGuards(options: LoopGuardOptions): ExtensionFactory {
	return (pi) => {
		const state: LoopGuardState = {
			goal: options.goal ?? "",
			toolCalls: 0,
			blocked: false,
			repeatedFailures: 0,
		};

		pi.on("agent_start", () => {
			state.goal = options.goal ?? "";
			state.toolCalls = 0;
			state.blocked = false;
			state.lastFailureSignature = undefined;
			state.repeatedFailures = 0;
			appendGuardEntry(pi, "agent_start", { maxToolCalls: options.maxToolCalls, maxFixIterations: options.maxFixIterations });
		});

		pi.on("tool_call", (event) => {
			state.toolCalls++;
			if (state.toolCalls > options.maxToolCalls) {
				const reason = `loop guard maxToolCalls exceeded (${options.maxToolCalls})`;
				appendGuardEntry(pi, "budget-block", { reason, tool: event.toolName, toolCalls: state.toolCalls });
				return block(reason);
			}

			if (isWriteTool(event) && isTestFixGoal(state.goal) && !allowsTestWrites(state.goal)) {
				const path = targetPath(event.input);
				if (path && isTestFile(path, options.profile)) {
					const reason = `reward-hacking guard blocked write to test file: ${path}`;
					appendGuardEntry(pi, "reward-hacking-block", { reason, path, tool: event.toolName });
					return block(reason);
				}
			}

			return undefined;
		});

		pi.on("tool_result", (event: ToolResultEvent) => {
			if (event.toolName !== "bash" || !bashLooksLikeTest(commandFrom(event as unknown as ToolCallEvent))) {
				return undefined;
			}
			const signature = createFailureSignature({ content: event.content, isError: event.isError });
			if (!signature) {
				state.lastFailureSignature = undefined;
				state.repeatedFailures = 0;
				return undefined;
			}
			if (signature.signature === state.lastFailureSignature) {
				state.repeatedFailures++;
			} else {
				state.lastFailureSignature = signature.signature;
				state.repeatedFailures = 1;
			}
			appendGuardEntry(pi, "test-failure", {
				signature: signature.signature,
				repeatedFailures: state.repeatedFailures,
				failingTests: signature.failingTests,
			});
			if (!state.blocked && state.repeatedFailures >= options.maxFixIterations) {
				state.blocked = true;
				const reason = `same test failure repeated ${state.repeatedFailures} times with no progress`;
				appendGuardEntry(pi, "no-progress-soft-stop", { reason, signature: signature.signature });
				sendSoftStop(pi, reason);
			}
			return undefined;
		});
	};
}

