import type { Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionFactory,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { targetPath } from "../policy/path-guard.ts";
import { createFailureSignature } from "./failure-signature.ts";
import { allowsTestWrites, isTestFile, isTestFixGoal } from "./test-file.ts";
import type { LoopGuardOptions, LoopGuardState } from "./types.ts";

interface AssistantUsageEvent {
	message: { role: string; usage?: Usage };
}

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

function textFromContent(content: ToolResultEvent["content"]): string {
	return content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

export function isPatchLocateFailureText(text: string): boolean {
	return /Could not find (?:the exact text|edits\[\d+\])|oldText must match exactly|Found \d+ occurrences.*(?:must be unique|oldText must be unique)/i.test(
		text,
	);
}

function isPatchLocateFailure(event: ToolResultEvent): boolean {
	return (
		event.isError &&
		(event.toolName === "edit" || event.toolName === "apply_patch") &&
		isPatchLocateFailureText(textFromContent(event.content))
	);
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

export function usageTokens(usage: Usage | undefined): number {
	if (!usage) {
		return 0;
	}
	if (Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) {
		return usage.totalTokens;
	}
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function assistantUsageFrom(event: AssistantUsageEvent): Usage | undefined {
	return event.message.role === "assistant" ? event.message.usage : undefined;
}

export function loopGuards(options: LoopGuardOptions): ExtensionFactory {
	return (pi) => {
		const state: LoopGuardState = {
			goal: options.goal ?? "",
			toolCalls: 0,
			blocked: false,
			tokenBudgetExceeded: false,
			totalTokens: 0,
			repeatedFailures: 0,
		};

		pi.on("agent_start", () => {
			state.goal = options.goal ?? "";
			state.toolCalls = 0;
			state.blocked = false;
			if (!state.tokenBudgetExceeded) {
				state.totalTokens = 0;
			}
			state.lastFailureSignature = undefined;
			state.repeatedFailures = 0;
			appendGuardEntry(pi, "agent_start", {
				maxToolCalls: options.maxToolCalls,
				maxFixIterations: options.maxFixIterations,
				tokenBudget: options.tokenBudget,
			});
		});

		pi.on("tool_call", (event) => {
			if (state.tokenBudgetExceeded) {
				const reason = `loop guard tokenBudget exceeded (${options.tokenBudget})`;
				appendGuardEntry(pi, "token-budget-block", { reason, tool: event.toolName, totalTokens: state.totalTokens });
				return block(reason);
			}

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

		pi.on("message_end", (event) => {
			const tokens = usageTokens(assistantUsageFrom(event));
			if (tokens <= 0) {
				return undefined;
			}
			state.totalTokens += tokens;
			appendGuardEntry(pi, "token-usage", {
				tokens,
				totalTokens: state.totalTokens,
				tokenBudget: options.tokenBudget,
			});
			if (!state.tokenBudgetExceeded && options.tokenBudget && state.totalTokens >= options.tokenBudget) {
				state.tokenBudgetExceeded = true;
				const reason = `token budget consumed (${state.totalTokens}/${options.tokenBudget})`;
				appendGuardEntry(pi, "token-budget-exceeded", {
					reason,
					totalTokens: state.totalTokens,
					tokenBudget: options.tokenBudget,
				});
				sendSoftStop(pi, reason);
			}
			return undefined;
		});

		pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
			if (isPatchLocateFailure(event)) {
				const reason = textFromContent(event.content).slice(0, 800);
				pi.appendEntry("patch-locate-failed", {
					tool: event.toolName,
					input: event.input,
					reason,
					hasUI: ctx.hasUI,
				});
				if (!ctx.hasUI) {
					sendSoftStop(pi, `patch locate failed: ${reason}`);
					return undefined;
				}
				const shouldRetry = await ctx.ui.confirm(
					"Patch 定位失败",
					`${reason}\n\n是否让 agent 重新读取目标文件并用更精确的上下文重试？`,
				);
				if (shouldRetry) {
					pi.sendMessage(
						{
							customType: "patch-locate-failed",
							content:
								"Patch locate failed. Re-read the target file, use a smaller unique oldText block, and retry once. Preserve the current diff if retrying still fails.",
							display: true,
							details: { reason },
						},
						{ deliverAs: "followUp" },
					);
				} else {
					sendSoftStop(pi, `patch locate failed: ${reason}`);
				}
				return undefined;
			}

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
