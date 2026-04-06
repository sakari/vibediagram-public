import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const VIRTUAL_ID = "virtual:ts-lib-files";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const require = createRequire(import.meta.url);

/**
 * Vite plugin that bundles TypeScript lib.*.d.ts files from node_modules
 * into a virtual module. Consumers import the module to get a Map<string, string>
 * of all lib declaration files, keyed by path (e.g. "/lib.es5.d.ts").
 *
 * Required because @typescript/vfs createDefaultMapFromCDN does not work
 * in Web Workers (no localStorage) or restricted browser environments.
 */
export function tsLibPlugin(): Plugin {
  return {
    name: "ts-lib-files",
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return;
      const tsDir = path.dirname(require.resolve("typescript/lib/lib.d.ts"));
      const libFiles = fs
        .readdirSync(tsDir)
        .filter((f: string) => f.startsWith("lib.") && f.endsWith(".d.ts"));
      const entries = libFiles.map((f: string) => {
        const content = fs.readFileSync(path.join(tsDir, f), "utf-8");
        return `[${JSON.stringify("/" + f)}, ${JSON.stringify(content)}]`;
      });
      return `export default new Map([${entries.join(",")}]);`;
    },
  };
}
