import { type ExtensionFactory, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendMemory } from "../context/memory.ts";

const rememberSchema = Type.Object({
	note: Type.String({ description: "Durable project fact to append to .agent/memory.md" }),
});

interface RememberDetails {
	note: string;
	path?: string;
}

export function rememberTool(cwd: string): ExtensionFactory {
	return (pi) => {
		pi.registerTool(
			defineTool<typeof rememberSchema, RememberDetails>({
				name: "remember",
				label: "remember",
				description: "Append a durable project fact to .agent/memory.md for future sessions.",
				promptSnippet: "remember(note): persist a short project memory fact",
				parameters: rememberSchema,
				async execute(_toolCallId, params) {
					const note = params.note.trim();
					if (!note) {
						return { content: [{ type: "text", text: "No memory note provided." }], details: { note }, isError: true };
					}
					const path = appendMemory(cwd, note);
					pi.appendEntry("memory-write", { note, path, at: new Date().toISOString() });
					return { content: [{ type: "text", text: `Remembered in ${path}` }], details: { note, path } };
				},
			}),
		);
	};
}
