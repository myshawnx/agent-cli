/**
 * Entry point.
 *
 * C0: parses args and either prints --version/--help, or shows "not implemented"
 *     for subcommands. No agent behavior yet — that starts in C1.
 */

import { createProgram } from "./cli/args.ts";

const program = createProgram();

// parseAsync: C1's actions are async (they build pi sessions and await turns).
// commander still handles --version / --help; the default action drives read-only Q&A.
await program.parseAsync();
