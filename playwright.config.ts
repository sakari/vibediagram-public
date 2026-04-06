import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright CLI configuration for E2E testing.
 *
 * Run tests:       pnpm e2e
 * UI mode:         pnpm e2e:ui
 * Headed:          pnpm e2e -- --headed
 * Debug:           pnpm e2e:debug
 * Codegen:         pnpm e2e:codegen
 *
 * For agentic / exploratory testing, use codegen or UI mode to interactively
 * discover and record test flows, then refine them into stable tests.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
      extraHTTPHeaders: {
        "x-vercel-protection-bypass":
          process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      },
    }),
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: "npx tsx e2e/jazz-sync-server.ts",
      url: "http://localhost:4200/health",
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
    {
      command: "VITE_JAZZ_SYNC_PEER=ws://localhost:4200 pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
