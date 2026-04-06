import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIRTUAL_ID = "virtual:help-files";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELP_DIR = path.resolve(__dirname, "help");
const EXAMPLES_DIR = path.resolve(__dirname, "../../sim-examples/src");

const HELP_DOCS = [
  { virtualPath: "/help/README.md", diskFile: "README.md" },
  {
    virtualPath: "/help/reference/api-reference.md",
    diskFile: "reference/api-reference.md",
  },
  {
    virtualPath: "/help/reference/metrics.md",
    diskFile: "reference/metrics.md",
  },
  {
    virtualPath: "/help/reference/inputs.md",
    diskFile: "reference/inputs.md",
  },
  {
    virtualPath: "/help/reference/distributions.md",
    diskFile: "reference/distributions.md",
  },
  {
    virtualPath: "/help/reference/builtin-blueprints.md",
    diskFile: "reference/builtin-blueprints.md",
  },
  {
    virtualPath: "/help/reference/styling.md",
    diskFile: "reference/styling.md",
  },
];

const HELP_EXAMPLES = [
  { virtualPath: "/help/examples/cache.ts", diskFile: "cache-example.ts" },
  {
    virtualPath: "/help/examples/loadbalancer.ts",
    diskFile: "loadbalancer-example.ts",
  },
  {
    virtualPath: "/help/examples/worker-pool.ts",
    diskFile: "worker-pool-example.ts",
  },
];

/**
 * Reads help documentation and example files at build time and exposes
 * them as a virtual module.
 *
 * Returns the same `{ path, content }[]` shape as `virtual:sim-model-dts`,
 * so they can be merged into the editor's read-only file tree.
 */
export function generateHelpEntries(): { path: string; content: string }[] {
  const entries: { path: string; content: string }[] = [];

  for (const doc of HELP_DOCS) {
    const content = fs.readFileSync(path.join(HELP_DIR, doc.diskFile), "utf8");
    entries.push({ path: doc.virtualPath, content });
  }

  for (const example of HELP_EXAMPLES) {
    const content = fs.readFileSync(
      path.join(EXAMPLES_DIR, example.diskFile),
      "utf8",
    );
    entries.push({ path: example.virtualPath, content });
  }

  return entries;
}

/**
 * Vite plugin that bundles help documentation and sim-examples into
 * a virtual module for the browser editor.
 *
 * Consumers import `virtual:help-files` to get an array of
 * `{ path: string; content: string }` entries.
 *
 * Usage in vite.config.ts:
 * ```ts
 * import { helpFilesPlugin } from "@diagram/ts-worker/vite-plugin-help-files";
 * export default defineConfig({ plugins: [helpFilesPlugin()] });
 * ```
 */
export function helpFilesPlugin(): Plugin {
  return {
    name: "help-files",
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return;
      const entries = generateHelpEntries();
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
