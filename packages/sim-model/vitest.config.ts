import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/builtins/**/index.ts",
        "src/builtins/distributions/test-prng.ts",
        "src/**/*.bench.ts",
      ],
      all: true,
      thresholds: {
        statements: 99,
        branches: 98,
        functions: 97,
        lines: 99,
      },
    },
  },
  bench: {
    include: ["src/**/*.bench.ts"],
  },
});
