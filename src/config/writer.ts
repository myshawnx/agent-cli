import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Compile } from "typebox/compile";
import { type PolicyConfig, PolicyConfigSchema, type ProjectProfile, ProjectProfileSchema } from "./schema.js";

const policyValidator = Compile(PolicyConfigSchema);
const profileValidator = Compile(ProjectProfileSchema);

function ensureDir(path: string): void {
	const d = dirname(path);
	if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function atomicWrite(path: string, content: string): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, path);
}

export function writePolicy(cwd: string, value: PolicyConfig): string[] {
	const errors: string[] = [];
	if (!policyValidator.Check(value)) {
		for (const e of policyValidator.Errors(value)) {
			errors.push(`${e.instancePath ?? "/"}: ${e.message ?? "invalid"}`);
		}
		return errors;
	}
	const dir = `${cwd}/.agent`;
	ensureDir(`${dir}/dummy`);
	atomicWrite(`${dir}/policy.json`, JSON.stringify(value, null, "\t"));
	return [];
}

export function writeProfile(cwd: string, value: ProjectProfile): string[] {
	const errors: string[] = [];
	if (!profileValidator.Check(value)) {
		for (const e of profileValidator.Errors(value)) {
			errors.push(`${e.instancePath ?? "/"}: ${e.message ?? "invalid"}`);
		}
		return errors;
	}
	const dir = `${cwd}/.agent`;
	ensureDir(`${dir}/dummy`);
	atomicWrite(`${dir}/project-profile.json`, JSON.stringify(value, null, "\t"));
	return [];
}

export function writeMemory(cwd: string, text: string): void {
	const dir = `${cwd}/.agent`;
	ensureDir(`${dir}/dummy`);
	const tmp = `${dir}/memory.md.tmp`;
	writeFileSync(tmp, text, "utf8");
	renameSync(tmp, `${dir}/memory.md`);
}
