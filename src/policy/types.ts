/**
 * Approval-mode type — shared seam for every later cycle.
 *
 * C1 only ever uses `"readonly"`; the other three values are consumed by the C2
 * policy engine. The canonical definition (and its TypeBox value form) lives in
 * `config/schema.ts` so the on-disk schema and the runtime type can never drift.
 * This module re-exports just the *type*, so runtime code can depend on the
 * approval-mode contract without pulling in TypeBox.
 */

export type { ApprovalMode } from "../config/schema.ts";
