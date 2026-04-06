import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/*.bench.ts"],
      all: true,
      thresholds: {
        statements: 97,
        branches: 95,
        functions: 100,
        lines: 97,
      },
    },
  },
  bench: {
    include: ["src/**/*.bench.ts"],
  },
});
