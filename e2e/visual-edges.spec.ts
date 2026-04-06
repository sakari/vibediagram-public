import { test, expect } from "@playwright/test";

test.describe("Visual Regression – Edges", () => {
  test.use({ viewport: { width: 1280, height: 1024 } });

  test("edges connect correctly across topology", async ({ page }) => {
    await page.goto("/projects");
    await page.locator(".example-card", { hasText: "Load Balancer" }).click();

    // Wait for the full pipeline: navigate → load code → debounce → compile →
    // bundle → preview → ELK layout → React Flow render
    await expect(page.locator(".react-flow__node").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    await expect(page.locator(".diagram-pane")).toHaveScreenshot(
      "edges-loadbalancer.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      },
    );
  });
});
