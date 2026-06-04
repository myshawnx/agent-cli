/**
 * Entry point.
 *
 * C0: parses args and either prints --version/--help, or shows "not implemented"
 *     for subcommands. No agent behavior yet — that starts in C1.
 */

import { createProgram } from "./cli/args.js";

const program = createProgram();

// commander .parse() handles --version, --help, and "no subcommand => help" itself.
// Subcommands that aren't registered yet throw via their notReady action.
program.parse();
