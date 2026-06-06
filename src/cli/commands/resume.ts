import { existsSync } from "node:fs";
import { SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadAgentConfig } from "../../config/loader.ts";
import { loadMemory } from "../../context/memory.ts";
import { detectProfile, loadProfile } from "../../context/profile.ts";
import type { ProjectContext } from "../../context/types.ts";
import type { ApprovalMode } from "../../policy/types.ts";
import { drive, driveInteractive } from "../../runtime/driver.ts";
import { buildResourceLoader } from "../../runtime/resource-loader.ts";
import { buildSession } from "../../runtime/session-factory.ts";

export interface ResumeOptions {
	cwd: string;
	session: string;
	prompt?: string;
	printMode: boolean;
	mode: ApprovalMode;
	modelId?: string;
}

async function buildContext(cwd: string, mode: ApprovalMode, goal?: string): Promise<ProjectContext> {
	const config = loadAgentConfig(cwd);
	const profile = loadProfile(cwd) ?? config.profile ?? (await detectProfile(cwd));
	return { cwd, mode, goal, policy: config.policy, profile, memory: loadMemory(cwd) || config.memory };
}

async function resolveSessionPath(cwd: string, session: string): Promise<string | undefined> {
	if (existsSync(session)) {
		return session;
	}
	const sessions = await SessionManager.list(cwd);
	return sessions.find((item) => item.id === session || item.path === session)?.path;
}

export async function runResume(opts: ResumeOptions): Promise<number> {
	const sessionPath = await resolveSessionPath(opts.cwd, opts.session);
	if (!sessionPath) {
		process.stderr.write(`No session found for "${opts.session}". Run agent history first.\n`);
		return 1;
	}
	const prompt = opts.prompt?.trim() || undefined;
	const sessionManager = SessionManager.open(sessionPath, undefined, opts.cwd);

	const ctx = await buildContext(opts.cwd, opts.mode, prompt);
	if (!opts.printMode) {
		await driveInteractive({
			ctx,
			prompt,
			modelId: opts.modelId,
			agentDir: getAgentDir(),
			sessionManager,
		});
		return 0;
	}
	if (!prompt) {
		process.stdout.write(
			`Resolved session: ${sessionPath}\nPass a prompt after the id to continue it in print mode.\n`,
		);
		return 0;
	}
	const resourceLoader = buildResourceLoader(ctx);
	await resourceLoader.reload();
	const { session: agentSession } = await buildSession({
		cwd: opts.cwd,
		mode: opts.mode,
		resourceLoader,
		modelId: opts.modelId,
		agentDir: getAgentDir(),
		sessionManager,
	});
	await drive(agentSession, { printMode: true, prompt });
	return 0;
}
