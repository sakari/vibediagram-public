/**
 * Bundles multiple in-memory JS files into a single IIFE string using Rollup.
 *
 * Used by sim-worker to compile multi-file user projects into a single
 * evaluable script. Imports from `@diagram/sim-model` are resolved to a shim
 * that reads from `__simModelGlobals`, which sim-worker provides at runtime
 * via `new Function("__simModelGlobals", iifeCode)(globals)`.
 */
import { rollup, type Plugin } from "@rollup/browser";
import * as simModel from "@diagram/sim-model";

/**
 * Runtime export names from `@diagram/sim-model`, derived dynamically so the
 * shim stays in sync with the package automatically — no manual list to maintain.
 */
const SIM_MODEL_EXPORTS = Object.keys(simModel);

const SIM_MODEL_SPECIFIER = "@diagram/sim-model";
const SIM_MODEL_SHIM_ID = "\0sim-model-shim";

/** Synthetic shim source that re-exports each global from `__simModelGlobals`. */
const SIM_MODEL_SHIM_CODE = SIM_MODEL_EXPORTS.map(
  (name) => `export const ${name} = __simModelGlobals.${name};`,
).join("\n");

/** Resolve `.` and `..` segments in a virtual path. */
function normalizePath(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return "/" + out.join("/");
}

/**
 * Creates a Rollup plugin that resolves and loads modules from an in-memory
 * file map. Also intercepts `@diagram/sim-model` imports and redirects them
 * to a shim module that reads from `__simModelGlobals`.
 */
function virtualFsPlugin(files: Record<string, string>): Plugin {
  return {
    name: "virtual-fs",

    resolveId(source: string, importer: string | undefined) {
      // @diagram/sim-model always resolves to the shim
      if (source === SIM_MODEL_SPECIFIER) {
        return SIM_MODEL_SHIM_ID;
      }

      // Resolve relative and absolute paths against the importer
      if (
        source.startsWith("./") ||
        source.startsWith("../") ||
        source.startsWith("/")
      ) {
        let resolved = source;
        if (importer && !source.startsWith("/")) {
          const dir = importer.substring(0, importer.lastIndexOf("/"));
          resolved = normalizePath(dir + "/" + source);
        }
        // Try exact, then with .js / .ts extensions
        if (resolved in files) return resolved;
        if (resolved + ".js" in files) return resolved + ".js";
        if (resolved + ".ts" in files) return resolved + ".ts";
      }

      // Bare specifier lookup (non-relative, non-@diagram/sim-model)
      if (source in files) return source;

      return null;
    },

    load(id: string) {
      if (id === SIM_MODEL_SHIM_ID) return SIM_MODEL_SHIM_CODE;
      if (id in files) return files[id];
      return null;
    },
  };
}

/**
 * Bundles in-memory JS files into a single IIFE string.
 *
 * @param files      Compiled JS keyed by virtual path (e.g. `{ "/main.js": "..." }`)
 * @param entryPath  Entry point path that must exist in `files` (e.g. `"/main.js"`)
 * @returns          IIFE source code string ready for evaluation
 */
export async function bundle(
  files: Record<string, string>,
  entryPath: string,
): Promise<string> {
  const build = await rollup({
    input: entryPath,
    plugins: [virtualFsPlugin(files)],
  });

  const { output } = await build.generate({ format: "iife" });
  return output[0].code;
}
