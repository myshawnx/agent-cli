import {
	type BashOperations,
	type BashToolInput,
	type ExtensionFactory,
	createBashToolDefinition,
	createLocalBashOperations,
} from "@earendil-works/pi-coding-agent";
export { applyCommandTimeout, commandTimeoutSeconds, withCommandTimeout } from "./bash-timeout-core.ts";
import { commandTimeoutSeconds, withCommandTimeout } from "./bash-timeout-core.ts";

function createTimeoutOperations(commandTimeoutMs: number | undefined): BashOperations {
	const local = createLocalBashOperations();
	return {
		exec(command, cwd, options) {
			const timeoutSeconds = commandTimeoutSeconds(commandTimeoutMs);
			const currentTimeout = typeof options.timeout === "number" ? options.timeout : undefined;
			const boundedTimeout = timeoutSeconds
				? Math.min(currentTimeout ?? timeoutSeconds, timeoutSeconds)
				: currentTimeout;
			return withCommandTimeout(commandTimeoutMs, options.signal, (signal) =>
				local.exec(command, cwd, {
					...options,
					signal,
					timeout: boundedTimeout,
				}),
			);
		},
	};
}

export function commandTimeoutBash(cwd: string, commandTimeoutMs: number | undefined): ExtensionFactory {
	return (pi) => {
		if (!commandTimeoutMs || commandTimeoutMs <= 0) {
			return;
		}
		const bashTool = createBashToolDefinition(cwd, {
			operations: createTimeoutOperations(commandTimeoutMs),
		});
		const timeoutSeconds = commandTimeoutSeconds(commandTimeoutMs);
		pi.registerTool({
			...bashTool,
			async execute(toolCallId, params: BashToolInput, signal, onUpdate, ctx) {
				if (timeoutSeconds && (!params.timeout || params.timeout > timeoutSeconds)) {
					params.timeout = timeoutSeconds;
				}
				return bashTool.execute(toolCallId, params, signal, onUpdate, ctx);
			},
		});
	};
}
