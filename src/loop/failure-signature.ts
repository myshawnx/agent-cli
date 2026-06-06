import { createHash } from "node:crypto";

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export interface FailureSignature {
	signature: string;
	failingTests: string[];
	passedCount?: number;
}

function textFromContent(content: unknown): string {
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((item) => {
			if (item && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
				const text = (item as Record<string, unknown>).text;
				return typeof text === "string" ? text : "";
			}
			return "";
		})
		.join("\n");
}

export function normalizeFailureText(text: string): string {
	return text
		.replace(ANSI_ESCAPE_RE, "")
		.replace(/\b\d+(?:\.\d+)?\s?ms\b/g, "<time>")
		.replace(/\b\d{2}:\d{2}:\d{2}\b/g, "<clock>")
		.replace(/[A-Z]:\\[^\s)]+/g, "<path>")
		.replace(/\/[^\s)]+/g, "<path>")
		.replace(/\s+/g, " ")
		.trim();
}

export function extractPassedCount(text: string): number | undefined {
	const match = text.match(/(?:Tests?|tests?)\s+([0-9]+)\s+passed|([0-9]+)\s+passed/i);
	const value = match?.[1] ?? match?.[2];
	return value ? Number(value) : undefined;
}

export function extractFailingTests(text: string): string[] {
	const lines = text.split(/\r?\n/).map((line) => line.trim());
	const failures = new Set<string>();
	for (const line of lines) {
		const vitest = line.match(/^(?:FAIL|FAILED|×|✗|⨯)\s+(.+)/i);
		if (vitest?.[1]) {
			failures.add(normalizeFailureText(vitest[1]).slice(0, 160));
		}
		const assertion = line.match(/(?:AssertionError|Error:)\s+(.+)/i);
		if (assertion?.[1]) {
			failures.add(normalizeFailureText(assertion[1]).slice(0, 160));
		}
	}
	return [...failures];
}

export function createFailureSignature(input: { content?: unknown; isError?: boolean }): FailureSignature | undefined {
	const raw = textFromContent(input.content);
	if (!raw.trim()) {
		return undefined;
	}
	const failingTests = extractFailingTests(raw);
	const normalized = normalizeFailureText(failingTests.length ? failingTests.join("\n") : raw).slice(0, 4_000);
	if (!input.isError && !/\b(fail|failed|error|AssertionError)\b/i.test(raw)) {
		return undefined;
	}
	return {
		signature: createHash("sha256").update(normalized).digest("hex").slice(0, 16),
		failingTests,
		passedCount: extractPassedCount(raw),
	};
}
