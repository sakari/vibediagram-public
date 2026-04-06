import { test, expect } from "@playwright/test";

test.describe("Diagram Workspace", () => {
  test("loads app and navigates to diagram workspace", async ({ page }) => {
    await page.goto("/");

    // The app redirects / → /diagram, which creates a new diagram and
    // navigates to /diagram/:id. Wait for the workspace to appear.
    const workspace = page.locator(".split-container");
    await expect(workspace).toBeVisible({ timeout: 15_000 });

    // Verify the two-pane layout rendered
    await expect(page.locator(".left-pane")).toBeVisible();
    await expect(page.locator(".right-pane")).toBeVisible();

    // The URL should have been updated to include a diagram ID
    await expect(page).toHaveURL(/\/diagram\/.+/);
  });
});
