import { test, expect } from "@playwright/test";

test.describe("Visual Regression – Groups", () => {
  test.use({ viewport: { width: 1280, height: 1024 } });

  test("renders groups with metric children", async ({ page }) => {
    await page.goto("/projects");
    await page.locator(".example-card", { hasText: "Cache Layer" }).click();

    // Wait for the full pipeline: navigate → load code → debounce → compile →
    // bundle → preview → ELK layout → React Flow render
    await expect(page.locator(".react-flow__node").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    await expect(page.locator(".diagram-pane")).toHaveScreenshot(
      "groups-cache.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      },
    );
  });
});
