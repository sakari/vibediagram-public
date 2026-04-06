import type { Plugin } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const VIRTUAL_ID = "virtual:sim-model-dts";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Generates TypeScript declaration files from the sim-model package source.
 *
 * Uses TypeScript's `createProgram` API with `declaration: true` and
 * `emitDeclarationOnly: true` to produce `.d.ts` output from the
 * sim-model barrel export. Each emitted file is mapped to a path under
 * `/node_modules/@diagram/sim-model/` so relative imports between
 * declaration files resolve correctly in the VFS.
 */
export function generateSimModelDeclarations(): {
  path: string;
  content: string;
}[] {
  const simModelIndex = path.resolve(__dirname, "../../sim-model/src/index.ts");

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    declaration: true,
    emitDeclarationOnly: true,
    // Avoid writing files to disk — we capture output in memory
    outDir: "/virtual-out",
  };

  const program = ts.createProgram([simModelIndex], compilerOptions);

  const emittedFiles: { fileName: string; content: string }[] = [];

  program.emit(undefined, (fileName, text) => {
    emittedFiles.push({ fileName, content: text });
  });

  const dtsFiles = emittedFiles.filter((f) => f.fileName.endsWith(".d.ts"));

  if (dtsFiles.length === 0) {
    throw new Error(
      "Failed to generate any .d.ts files from sim-model. " +
        `Emitted files: ${emittedFiles.map((f) => f.fileName).join(", ")}`,
    );
  }

  // Map each emitted file from /virtual-out/... to /node_modules/@diagram/sim-model/...
  // so relative imports between declaration files resolve in the VFS.
  const PREFIX = "/virtual-out/";
  const TARGET = "/node_modules/@diagram/sim-model/";

  return dtsFiles.map((f) => ({
    path: f.fileName.startsWith(PREFIX)
      ? TARGET + f.fileName.slice(PREFIX.length)
      : TARGET + f.fileName,
    content: f.content,
  }));
}

/**
 * Vite plugin that generates TypeScript declarations from the
 * `@diagram/sim-model` package and exposes them as a virtual module.
 *
 * Consumers import `virtual:sim-model-dts` to get an array of
 * `{ path: string; content: string }` entries suitable for use as
 * `extraLibs` in a TypeScript language service VFS, enabling module
 * resolution of `import { ... } from "@diagram/sim-model"` in user code.
 *
 * Usage in vite.config.ts:
 * ```ts
 * import { simModelDtsPlugin } from "@diagram/ts-worker/vite-plugin-sim-model-dts";
 * export default defineConfig({ plugins: [simModelDtsPlugin()] });
 * ```
 */
export function simModelDtsPlugin(): Plugin {
  return {
    name: "sim-model-dts",
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return;

      const declarationEntries = generateSimModelDeclarations();

      const packageJson = JSON.stringify({
        name: "@diagram/sim-model",
        types: "index.d.ts",
      });

      const entries = [
        {
          path: "/node_modules/@diagram/sim-model/package.json",
          content: packageJson,
        },
        ...declarationEntries,
      ];

      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
