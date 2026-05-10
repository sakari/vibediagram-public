import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression for the CriticMarkup comment UI in `.md` files.
 *
 * Pattern mirrors visual-shapes.spec.ts / visual-dynamic.spec.ts: load the app
 * via /projects, drive the UI to display a known markdown document, then
 * snapshot the preview pane. Markdown documents render into the right pane as
 * `.md-preview` (the markdown-view sibling of `.diagram-pane` for diagrams) so
 * the screenshots target that element.
 */

async function seedAndCreateProject(page: Page): Promise<void> {
  // Seed Jazz API key so the welcome gate does not block automation when the
  // dev server is not started with VITE_JAZZ_SYNC_PEER.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("vibediagram-jazz-api-key", "e2e-test-key");
  });
  await page.goto("/projects");
  await page.locator(".project-card", { hasText: "+ New Project" }).click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
}

async function createMarkdownFile(page: Page, content: string): Promise<void> {
  // Add a new top-level `.md` file via the file tree's "+" affordance.
  await page.locator('button[aria-label="New file at root"]').click();
  const nameInput = page.locator('input[value=""]').first();
  await nameInput.fill("notes.md");
  await page.keyboard.press("Enter");

  // Open the new file. The file tree opens it on click; the editor focuses
  // the empty document.
  await page.locator(".cm-editor").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");

  // Paste the content directly via the clipboard API — `keyboard.type`
  // mishandles the `{`, `}`, `<`, `>`, `@` characters on some keymaps and is
  // also slow for multi-line bodies.
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, content);
  await page.keyboard.press("Control+V");

  // Wait for editor → FileStore debounce (300ms) → preview render.
  await expect(page.locator(".md-preview")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".md-preview")).toContainText("@", {
    timeout: 10_000,
  });
  // Allow margin layout (mounts after first paint to read DOM rects) to
  // converge.
  await page.waitForTimeout(1500);
}

test.describe("Visual Regression – Markdown Comments", () => {
  test.use({ viewport: { width: 1280, height: 1024 } });

  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("inline comment thread renders a margin bubble", async ({ page }) => {
    await seedAndCreateProject(page);
    await createMarkdownFile(
      page,
      [
        "# Notes",
        "",
        "The cache is read-through {==and write-back==}{>>id:c1 by:@alice 2026-05-09T10:00:00Z: looks fine<<}.",
        "",
      ].join("\n"),
    );

    await expect(page.locator(".md-preview")).toHaveScreenshot(
      "comments-inline.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      },
    );
  });

  test("block-target thread renders next to a Mermaid diagram", async ({
    page,
  }) => {
    await seedAndCreateProject(page);
    await createMarkdownFile(
      page,
      [
        "# Architecture",
        "",
        "{>>block id:c2 target:next | by:@bob 2026-05-09T10:00:00Z: should we add a cache here?<<}",
        "",
        "```mermaid",
        "flowchart LR",
        "  A[Client] --> B[Server]",
        "  B --> C[(Database)]",
        "```",
        "",
      ].join("\n"),
    );

    await expect(page.locator(".md-preview")).toHaveScreenshot(
      "comments-block-mermaid.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      },
    );
  });

  test("resolved thread is dimmed", async ({ page }) => {
    await seedAndCreateProject(page);
    await createMarkdownFile(
      page,
      [
        "# Done",
        "",
        "We {==already==}{>>id:c3 resolved:true | by:@alice 2026-05-09T10:00:00Z: typo? | by:@bob 2026-05-09T11:00:00Z: fixed<<} fixed this.",
        "",
      ].join("\n"),
    );

    await expect(page.locator(".md-preview")).toHaveScreenshot(
      "comments-resolved.png",
      {
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      },
    );
  });
});
