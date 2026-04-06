import { test, expect, type Page } from "@playwright/test";

async function waitForEditor(page: Page) {
  await expect(page.locator(".split-container")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 10_000 });
}

test.describe("Jazz Cloud Sync", () => {
  test("edits in one tab appear in a second tab viewing the same diagram", async ({
    context,
  }) => {
    // Open tab 1 — creates a new diagram via local Jazz sync server
    const tab1 = await context.newPage();
    await tab1.goto("/");
    await waitForEditor(tab1);

    // Grab the diagram URL (includes the Jazz CoMap ID)
    await expect(tab1).toHaveURL(/\/diagram\/.+/);
    const diagramUrl = tab1.url();

    // Open tab 2 in the same browser context (same Jazz identity)
    const tab2 = await context.newPage();
    await tab2.goto(diagramUrl);
    await waitForEditor(tab2);

    // Verify tab 2 loaded the same initial content
    const tab1Content = await tab1.locator(".cm-content").textContent();
    const tab2Content = await tab2.locator(".cm-content").textContent();
    expect(tab1Content).toBeTruthy();
    expect(tab2Content).toBe(tab1Content);

    // Type a distinctive comment at the top of tab 1's editor
    const marker = `// sync-test-${Date.now()}`;
    await tab1.locator(".cm-content").click();
    await tab1.keyboard.press("Home");
    await tab1.keyboard.press("Control+Home");
    await tab1.keyboard.type(marker + "\n");

    // Confirm tab 1 has the marker
    await expect(tab1.locator(".cm-content")).toContainText(marker);

    // Wait for the edit to sync: editor debounce (300ms) → FileStore write →
    // Jazz applyDiff → local sync server → tab 2 subscription → editor update
    await expect(tab2.locator(".cm-content")).toContainText(marker, {
      timeout: 15_000,
    });
  });
});
