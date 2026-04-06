import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { simModelDtsPlugin } from "@diagram/ts-worker/vite-plugin-sim-model-dts";
import { helpFilesPlugin } from "@diagram/ts-worker/vite-plugin-help-files";

const require = createRequire(import.meta.url);

/**
 * Inlined from @diagram/ts-worker/vite-plugin. Bundles TypeScript lib.*.d.ts
 * files into a virtual module so the editor's ts-worker has access to TS
 * standard lib declarations at runtime.
 */
function tsLibPlugin(): Plugin {
  const VIRTUAL_ID = "virtual:ts-lib-files";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
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

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __DEPLOYMENT_ID__: JSON.stringify(
      process.env.VERCEL_DEPLOYMENT_ID ?? "local",
    ),
    __DEPLOYMENT_URL__: JSON.stringify(process.env.VERCEL_URL ?? ""),
  },
  plugins: [react(), tsLibPlugin(), simModelDtsPlugin(), helpFilesPlugin()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  esbuild: {
    target: "esnext",
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "esnext",
    rollupOptions: {
      external: ["elkjs/lib/elk.bundled.js"],
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          jazz: ["jazz-tools"],
        },
      },
    },
  },
  worker: {
    format: "es",
    plugins: () => [tsLibPlugin()],
  },
  optimizeDeps: {
    exclude: ["@rollup/browser"],
  },
  server: {
    port: 3000,
    open: true,
  },
});
