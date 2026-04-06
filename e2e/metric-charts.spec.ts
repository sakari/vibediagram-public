import { test, expect } from "@playwright/test";

test.describe("Metric Charts", () => {
  test("shows SVG chart in metric nodes after simulation runs", async ({
    page,
  }) => {
    await page.goto("/");

    // Wait for the workspace to load.
    const workspace = page.locator(".split-container");
    await expect(workspace).toBeVisible({ timeout: 15_000 });

    // Wait for the editor preview to render the diagram (the default model
    // auto-compiles on load).
    const diagram = page.locator(".diagram-pane");
    await expect(diagram).toBeVisible({ timeout: 10_000 });

    // Click "Run" to start the simulation.
    const runButton = page.locator("button.sim-btn-primary", {
      hasText: "Run",
    });
    await expect(runButton).toBeVisible({ timeout: 5_000 });
    await runButton.click();

    // Wait for the simulation to start running — the status badge should
    // switch from "idle" to "running" (or eventually "done" for fast sims).
    await expect(
      page.locator(".sim-status-running, .sim-status-done"),
    ).toBeVisible({ timeout: 10_000 });

    // Wait a moment for a few snapshot cycles so chart data accumulates.
    await page.waitForTimeout(2_000);

    // Verify that at least one SVG chart element exists in the diagram.
    // MetricChart renders <svg role="img" aria-label="metric chart">.
    const chart = diagram.locator('svg[aria-label="metric chart"]');
    await expect(chart.first()).toBeVisible({ timeout: 10_000 });

    // Verify the chart contains at least one path (the line) or circle (single point).
    const lineOrDot = chart.first().locator("path, circle");
    await expect(lineOrDot.first()).toBeVisible();
  });
});
