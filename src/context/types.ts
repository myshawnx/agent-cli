/**
 * The per-invocation context object threaded through the runtime.
 *
 * C1 keeps it intentionally small (cwd + mode + profile + memory). C2 onward will
 * add `policy` / `mcpConfig` fields here as those layers come online — this is the
 * shared bag the resource loader and session factory read from.
 */

import type { ProjectProfile } from "../config/schema.ts";
import type { ApprovalMode } from "../policy/types.ts";

export interface ProjectContext {
	cwd: string;
	/** C1 is always "readonly"; later cycles widen this. */
	mode: ApprovalMode;
	profile?: ProjectProfile;
	/** Raw `.agent/memory.md` text ("" when absent). */
	memory: string;
}
