/**
 * Re-exports build-generated sim-model type declarations for use as
 * extraLibs in the editor's TypeScript language service.
 *
 * The virtual module is provided by simModelDtsPlugin (registered in
 * vite.config.ts) which runs tsc on @diagram/sim-model at build time.
 */
import simModelDtsEntries from "virtual:sim-model-dts";

/**
 * Help documentation and example files bundled at build time.
 * Appears as read-only files in the editor's file tree.
 */
import helpFileEntries from "virtual:help-files";

export const SIM_MODEL_EXTRA_LIBS = simModelDtsEntries;
export const HELP_FILE_ENTRIES = helpFileEntries;
