import { describe, expect, it } from "vitest";
import { toTypeBox } from "../../src/mcp/schema-map.ts";

describe("toTypeBox", () => {
	it("maps object properties and required fields", () => {
		const schema = toTypeBox({
			type: "object",
			description: "tool input",
			required: ["name", "count"],
			properties: {
				name: { type: "string", description: "display name" },
				count: { type: "integer" },
				enabled: { type: "boolean" },
				tags: { type: "array", items: { type: "string" } },
				nested: {
					type: "object",
					required: ["value"],
					properties: {
						value: { type: "number" },
						note: { type: "string" },
					},
				},
			},
		});

		expect(schema).toEqual({
			type: "object",
			description: "tool input",
			required: ["name", "count"],
			properties: {
				name: { type: "string", description: "display name" },
				count: { type: "integer" },
				enabled: { type: "boolean" },
				tags: { type: "array", items: { type: "string" } },
				nested: {
					type: "object",
					required: ["value"],
					properties: {
						value: { type: "number" },
						note: { type: "string" },
					},
				},
			},
		});
	});

	it("maps string enums with StringEnum-compatible output", () => {
		const schema = toTypeBox({
			type: "string",
			description: "mode",
			enum: ["fast", "safe"],
		});

		expect(schema).toEqual({
			type: "string",
			description: "mode",
			enum: ["fast", "safe"],
		});
	});

	it("maps scalar branches", () => {
		expect(toTypeBox({ type: "string" })).toEqual({ type: "string" });
		expect(toTypeBox({ type: "number" })).toEqual({ type: "number" });
		expect(toTypeBox({ type: "integer" })).toEqual({ type: "integer" });
		expect(toTypeBox({ type: "boolean" })).toEqual({ type: "boolean" });
	});

	it("falls back to Type.Any for unsupported schemas", () => {
		expect(toTypeBox({ oneOf: [{ type: "string" }, { type: "number" }] })).toEqual({});
		expect(toTypeBox({ anyOf: [{ type: "string" }, { type: "number" }] })).toEqual({});
		expect(toTypeBox({ $ref: "#/defs/input" })).toEqual({});
		expect(toTypeBox({ description: "missing type" })).toEqual({});
	});

	it("falls back to Type.Any for recursive branches", () => {
		const recursive: Record<string, unknown> = {
			type: "object",
			properties: {},
		};
		recursive.properties = {
			self: recursive,
		};

		expect(toTypeBox(recursive)).toEqual({
			type: "object",
			properties: {
				self: {},
			},
		});
	});
});
