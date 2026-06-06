import { StringEnum } from "@earendil-works/pi-ai";
import { type TSchema, Type } from "typebox";

interface JsonSchemaNode {
	type?: unknown;
	description?: unknown;
	enum?: unknown;
	properties?: unknown;
	required?: unknown;
	items?: unknown;
	oneOf?: unknown;
	anyOf?: unknown;
	$ref?: unknown;
}

function asDescription(value: unknown): { description: string } | undefined {
	return typeof value === "string" && value.length > 0 ? { description: value } : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTypeBoxInner(schema: unknown, seen: Set<object>): TSchema {
	if (!isPlainRecord(schema)) {
		return Type.Any();
	}
	if (seen.has(schema)) {
		return Type.Any();
	}

	const node = schema as JsonSchemaNode;
	if (
		node.oneOf !== undefined ||
		node.anyOf !== undefined ||
		node.$ref !== undefined ||
		typeof node.type !== "string"
	) {
		return Type.Any();
	}

	seen.add(schema);
	try {
		switch (node.type) {
			case "object": {
				const properties = isPlainRecord(node.properties) ? node.properties : {};
				const required = Array.isArray(node.required)
					? new Set(node.required.filter((name): name is string => typeof name === "string"))
					: new Set<string>();
				const mapped = Object.fromEntries(
					Object.entries(properties).map(([name, value]) => {
						const propertySchema = toTypeBoxInner(value, seen);
						return [name, required.has(name) ? propertySchema : Type.Optional(propertySchema)];
					}),
				);
				return Type.Object(mapped, asDescription(node.description));
			}
			case "string": {
				const description = asDescription(node.description);
				if (Array.isArray(node.enum)) {
					const values = node.enum.filter((value): value is string => typeof value === "string");
					if (values.length > 0 && values.length === node.enum.length) {
						return StringEnum(values, description);
					}
				}
				return Type.String(description);
			}
			case "number":
				return Type.Number(asDescription(node.description));
			case "integer":
				return Type.Integer(asDescription(node.description));
			case "boolean":
				return Type.Boolean(asDescription(node.description));
			case "array":
				return Type.Array(toTypeBoxInner(node.items, seen), asDescription(node.description));
			default:
				return Type.Any();
		}
	} finally {
		seen.delete(schema);
	}
}

export function toTypeBox(schema: unknown): TSchema {
	return toTypeBoxInner(schema, new Set<object>());
}
