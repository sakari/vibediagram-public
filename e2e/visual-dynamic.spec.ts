import { test, expect } from "@playwright/test";

test.describe("Visual Regression – Dynamic", () => {
  test.use({ viewport: { width: 1280, height: 1024 } });

  test("new nodes appear after simulation spawns them", async ({ page }) => {
    await page.goto("/projects");
    await page.locator(".example-card", { hasText: "Worker Pool" }).click();

    // Wait for the full pipeline: navigate → load code → debounce → compile →
    // bundle → preview → ELK layout → React Flow render
    await expect(page.locator(".react-flow__node").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const nodeCountBefore = await page.locator(".react-flow__node").count();

    // "Before" screenshot — preview only, no simulation running
    await expect(page.locator(".diagram-pane")).toHaveScreenshot(
      "dynamic-before.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      },
    );

    // Run simulation — worker-pool's Supervisor spawns its first worker in
    // engineOnStart, so the topology gains a node as soon as the sim starts.
    await page.locator("button.sim-btn-primary", { hasText: "Run" }).click();
    await expect(
      page.locator(".sim-status-running, .sim-status-done"),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for topology change (new worker spawned)
    await expect(page.locator(".react-flow__node")).not.toHaveCount(
      nodeCountBefore,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(3000); // re-layout convergence

    // "After" screenshot — new nodes visible. Chart time-series are sampled
    // on the frontend via requestAnimationFrame and are therefore non-
    // deterministic across runs, so we mask them out. This lets us use the
    // same tight ratio as other tests to catch edge routing and layout
    // regressions in the dynamically spawned topology.
    await expect(page.locator(".diagram-pane")).toHaveScreenshot(
      "dynamic-after.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
        mask: [page.locator('svg[aria-label="metric chart"]')],
      },
    );
  });
});
