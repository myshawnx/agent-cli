/**
 * Read piped stdin, if any.
 *
 * Supports `cat build-error.log | agent -p "explain this"`. Returns undefined when
 * stdin is a TTY (interactive terminal, nothing piped) so we never block waiting for
 * input that will not come. Mirrors pi's own `readPipedStdin` semantics.
 */

export function readPipedStdin(): Promise<string | undefined> {
	// A TTY means an interactive terminal — nothing is being piped in.
	if (process.stdin.isTTY) {
		return Promise.resolve(undefined);
	}
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data.length > 0 ? data : undefined));
		process.stdin.on("error", () => resolve(undefined));
	});
}
