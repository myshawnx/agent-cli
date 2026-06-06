/**
 * C2 policy gateway extension.
 *
 * The gateway is the bridge from the pure policy engine into pi's extension event
 * stream. It runs before tool execution (`tool_call`), converts deny/confirm verdicts
 * into pi `{ block, reason }` results, records blocked decisions in the pi session,
 * and maintains the per-run changed-file count consumed by `classify`.
 */

import type {
	ExtensionContext,
	ExtensionFactory,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { applyCommandTimeout } from "../runtime/bash-timeout-core.ts";
import { classify, isWriteLikeTool } from "./engine.ts";
import type { ApprovalMode, PolicyConfig, Verdict } from "./types.ts";

function block(reason: string): ToolCallEventResult {
	return { block: true, reason };
}

function appendPolicyDeny(pi: Parameters<ExtensionFactory>[0], event: ToolCallEvent, reason: string): void {
	pi.appendEntry("policy-deny", { tool: event.toolName, reason });
}

async function resolveConfirm(
	verdict: Extract<Verdict, { kind: "confirm" }>,
	mode: ApprovalMode,
	ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
	if (mode === "auto") {
		return undefined;
	}
	if (!ctx.hasUI) {
		return block(`${verdict.reason} (无 UI,保守阻断)`);
	}
	const ok = await ctx.ui.confirm("高风险操作", verdict.reason);
	if (!ok) {
		return block("用户拒绝");
	}
	return undefined;
}

export function policyGateway(policy: PolicyConfig, mode: ApprovalMode, repoRoot: string): ExtensionFactory {
	return (pi) => {
		let changedFiles = 0;

		pi.on("agent_start", () => {
			changedFiles = 0;
		});

		pi.on("tool_call", async (event, ctx) => {
			applyCommandTimeout(event, policy.limits.commandTimeoutMs);
			const verdict = classify(event, mode, policy, { repoRoot, changedFiles });
			if (verdict.kind === "deny") {
				appendPolicyDeny(pi, event, verdict.reason);
				return block(verdict.reason);
			}
			if (verdict.kind === "confirm") {
				const result = await resolveConfirm(verdict, mode, ctx);
				if (result?.block) {
					appendPolicyDeny(pi, event, result.reason ?? verdict.reason);
					return result;
				}
			}
			if (isWriteLikeTool(event.toolName)) {
				changedFiles++;
			}
			return undefined;
		});
	};
}
