import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // @rollup/browser uses fetch() + WASM which is unavailable in Node.
      // Redirect to the Node build of rollup for vitest.
      "@rollup/browser": "rollup",
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      reportsDirectory: "./coverage",
      include: ["src/bundle.ts"],
      all: true,
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
  bench: {
    include: ["src/**/*.bench.ts"],
  },
});
