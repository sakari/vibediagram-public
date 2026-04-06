import { test, expect } from "@playwright/test";

test.describe("Visual Regression – Shapes", () => {
  test.use({ viewport: { width: 1280, height: 1024 } });

  test("renders all 6 node shapes with edges", async ({ page }) => {
    await page.goto("/projects");
    await page.locator(".example-card", { hasText: "All Shapes" }).click();

    // Wait for the full pipeline: navigate → load code → debounce → compile →
    // bundle → preview → ELK layout → React Flow render
    await expect(page.locator(".react-flow__node").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(3000); // measurement cycle convergence

    await expect(page.locator(".diagram-pane")).toHaveScreenshot(
      "all-shapes.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      },
    );
  });
});
