import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/coverage/",
      ".claude/",
      "plans/",
      "spikes/",
      "**/spikes/",
      "**/*.spike.*",
      "e2e/",
      "eslint.config.ts",
      "knip.config.ts",
      "playwright.config.ts",
      ".dependency-cruiser.cjs",
      "**/vite.config.ts",
      "**/vitest.config.ts",
      "**/vitest.browser.config.ts",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@diagram/*/src/**"],
              message:
                "Import through the package entry point, not through src/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*", "**/*.spec.*", "**/test-setup.*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@diagram/*/src/**"],
              message:
                "Import through the package entry point, not through src/.",
            },
            {
              group: ["**/*.test", "**/*.test.*", "**/*.spec", "**/*.spec.*"],
              message: "Production code must not import test files.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.browser.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["packages/frontend/**/*.{ts,tsx}", "packages/editor/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true },
      ],
    },
  },
);
