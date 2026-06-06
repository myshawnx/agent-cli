/**
 * `.agent/` configuration schemas (TypeBox).
 *
 * This module ONLY defines the on-disk shape of the three `.agent/` files and the
 * approval-mode enum. It deliberately contains NO behavior: the policy engine
 * (`classify`/gateway) lands in C2, profile detection in C1's `init`. Fields like
 * `limits` / `sandbox` are固化 here now so later cycles never have to migrate the
 * schema (see overview §3.2).
 */

import { type Static, Type } from "typebox";

export const ApprovalMode = Type.Union([
	Type.Literal("readonly"),
	Type.Literal("suggest"),
	Type.Literal("workspace-write"),
	Type.Literal("auto"),
]);
export type ApprovalMode = Static<typeof ApprovalMode>;

export const PolicyConfigSchema = Type.Object({
	command: Type.Object({
		allow: Type.Array(Type.String(), { default: [] }),
		confirm: Type.Array(Type.String(), { default: [] }),
		deny: Type.Array(Type.String(), { default: [] }),
	}),
	path: Type.Object({
		deny: Type.Array(Type.String(), { default: [] }),
		confirmWrite: Type.Array(Type.String(), { default: [] }),
	}),
	limits: Type.Object({
		maxChangedFiles: Type.Integer({ default: 20 }),
		maxFixIterations: Type.Integer({ default: 5 }),
		maxToolCalls: Type.Integer({ default: 50 }),
		tokenBudget: Type.Optional(Type.Integer()),
		commandTimeoutMs: Type.Optional(Type.Integer({ default: 120_000 })),
	}),
	sandbox: Type.Object({
		enabled: Type.Boolean({ default: false }),
	}),
});
export type PolicyConfig = Static<typeof PolicyConfigSchema>;

export const ProjectProfileSchema = Type.Object({
	language: Type.String(),
	packageManager: Type.String(),
	framework: Type.Optional(Type.String()),
	testFramework: Type.Optional(Type.String()),
	sourceDirs: Type.Array(Type.String(), { default: [] }),
	testDirs: Type.Array(Type.String(), { default: [] }),
	commands: Type.Object({
		test: Type.Optional(Type.String()),
		lint: Type.Optional(Type.String()),
		build: Type.Optional(Type.String()),
	}),
});
export type ProjectProfile = Static<typeof ProjectProfileSchema>;
