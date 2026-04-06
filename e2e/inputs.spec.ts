import { test, expect } from "@playwright/test";

/**
 * Regression guard: user edits to a `simInput` slider must survive a Run.
 *
 * Before the fix, clicking Run rebuilt the engine and the slider snapped back
 * to its default value. The Load Balancer example exposes a "Request Rate"
 * numeric input (default 40, range 1–200) that we use to exercise the flow.
 */
test.describe("simInput value persistence", () => {
  test.use({ viewport: { width: 1280, height: 1024 } });

  test("slider keeps edited value after Run", async ({ page }) => {
    // Seed a dummy Jazz API key so the welcome gate does not block the test
    // when the dev server is not started with VITE_JAZZ_SYNC_PEER.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("vibediagram-jazz-api-key", "e2e-test-key");
    });
    await page.goto("/projects");
    await page.locator(".example-card", { hasText: "Load Balancer" }).click();

    // Wait for pipeline: load → compile → bundle → preview → render
    await expect(page.locator(".react-flow__node").first()).toBeVisible({
      timeout: 30_000,
    });

    // Scope to the Request Rate simInput wrapper (label text disambiguates
    // from other input nodes that may exist in the diagram).
    const inputNode = page
      .locator("[data-testid='input-node']", { hasText: "Request Rate" })
      .first();
    const slider = inputNode.locator("[data-testid='input-slider']");
    const valueLabel = inputNode.locator("[data-testid='slider-value']");
    await expect(slider).toBeVisible({ timeout: 30_000 });

    // Sanity: default value is 40
    await expect(valueLabel).toHaveText("40");

    // Range inputs do not support Playwright's locator.fill(), so set the
    // value directly and fire the same events the React onChange relies on.
    const editedValue = "80";
    await slider.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, editedValue);

    // Edit reflected immediately, pre-Run
    await expect(valueLabel).toHaveText(editedValue);
    await expect(slider).toHaveValue(editedValue);

    // Kick off simulation
    await page.locator("button.sim-btn-primary", { hasText: "Run" }).click();

    // Status must leave idle — either running or already done
    await expect(
      page.locator(".sim-status-running, .sim-status-done"),
    ).toBeVisible({ timeout: 10_000 });

    // Regression assertion: the edited value survives the engine rebuild
    await expect(valueLabel).toHaveText(editedValue);
    await expect(slider).toHaveValue(editedValue);
  });
});
