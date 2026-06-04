/**
 * The per-invocation context object threaded through the runtime.
 *
 * C2 adds `policy` so the resource loader can mount the policyGateway before the
 * agent loop starts. C3+ will extend this with trace / MCP configuration as those
 * layers come online.
 */

import type { ProjectProfile } from "../config/schema.ts";
import type { ApprovalMode, PolicyConfig } from "../policy/types.ts";

export interface ProjectContext {
	cwd: string;
	/** Approval mode for this run. C2 supports all four modes. */
	mode: ApprovalMode;
	/** Loaded `.agent/policy.json` with defaults filled in. */
	policy: PolicyConfig;
	profile?: ProjectProfile;
	/** Raw `.agent/memory.md` text ("" when absent). */
	memory: string;
}
