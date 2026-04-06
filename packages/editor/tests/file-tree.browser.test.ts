import { describe, it, expect, afterEach, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { FileTreePanel } from "../src/tree/FileTreePanel.js";
import { MemoryFileStore } from "../src/store/MemoryFileStore.js";

function mountTree(
  store: MemoryFileStore,
  options?: { onSelect?: (path: string) => void; activeFile?: string | null },
): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(
    React.createElement(FileTreePanel, {
      fileStore: store,
      onSelect: options?.onSelect ?? (() => {}),
      activeFile: options?.activeFile ?? null,
      theme: "light",
    }),
  );
  const cleanup = () => {
    root.unmount();
    container.remove();
  };
  return { container, root, cleanup };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

async function waitForRender(_container: HTMLElement): Promise<void> {
  await new Promise((r) => requestAnimationFrame(r));
  await flush();
  await flush();
}

function findByText(container: HTMLElement, text: string): HTMLElement | null {
  const all = container.querySelectorAll("*");

  for (const el of all) {
    if (
      el instanceof HTMLElement &&
      el.children.length === 0 &&
      el.textContent.trim() === text
    )
      return el;
  }
  return null;
}

function getRowForName(
  container: HTMLElement,
  name: string,
): HTMLElement | null {
  const el = findByText(container, name);
  if (!el) return null;
  const row = el.closest('div[style*="display: flex"]');
  return row instanceof HTMLElement ? row : null;
}

async function waitForRow(
  container: HTMLElement,
  name: string,
  timeout = 3000,
): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const row = getRowForName(container, name);
    if (row) return row;
    await flush();
  }
  throw new Error(`Row "${name}" not found within ${timeout.toString()}ms`);
}

describe("FileTreePanel browser", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  it("[test-tree-render] renders tree with folders and files", async () => {
    const store = new MemoryFileStore({
      "/src/main.ts": "",
      "/src/utils/math.ts": "",
      "/src/utils/format.ts": "",
      "/README.md": "",
    });
    const { container, cleanup: c } = mountTree(store);
    cleanup = c;

    await waitForRender(container);

    const srcRow = await waitForRow(container, "src");
    srcRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(container.textContent).toContain("src");
    expect(container.textContent).toContain("main.ts");
    expect(container.textContent).toContain("README.md");
    expect(container.textContent).toContain("utils");
  });

  it("[test-click-opens] clicking file calls onSelect with path", async () => {
    const store = new MemoryFileStore({
      "/src/main.ts": "",
      "/README.md": "",
    });
    const onSelect = vi.fn();
    const { container, cleanup: c } = mountTree(store, { onSelect });
    cleanup = c;

    await waitForRender(container);

    const srcRow = await waitForRow(container, "src");
    srcRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    const mainRow = await waitForRow(container, "main.ts");
    mainRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith("/src/main.ts");
  });

  it("[test-create-file] new file action creates file in store", async () => {
    const store = new MemoryFileStore({ "/src/main.ts": "" });
    const { container, cleanup: c } = mountTree(store);
    cleanup = c;

    await waitForRender(container);

    const srcRow = await waitForRow(container, "src");
    await userEvent.hover(srcRow);
    await flush();

    const newFileBtn = container.querySelector('button[aria-label="New file"]');

    expect(newFileBtn).not.toBeNull();
    if (!(newFileBtn instanceof HTMLElement))
      throw new Error("newFileBtn is not an HTMLElement");
    await userEvent.click(newFileBtn);
    await flush();

    const input = container.querySelector('input[placeholder="Filename"]');
    expect(input).not.toBeNull();
    if (!(input instanceof HTMLInputElement))
      throw new Error("input is not an HTMLInputElement");
    await userEvent.type(input, "newfile.ts");
    await userEvent.keyboard("{Enter}");
    await flush();

    const files = store.listFiles();
    expect(files).toContain("/src/newfile.ts");
  });

  it("[test-rename] rename updates path in store", async () => {
    const store = new MemoryFileStore({ "/src/main.ts": "hello" });
    const { container, cleanup: c } = mountTree(store);
    cleanup = c;

    await waitForRender(container);

    const srcRow = await waitForRow(container, "src");
    srcRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flush();

    const mainRow = await waitForRow(container, "main.ts");
    await userEvent.hover(mainRow);
    await flush();

    const renameBtn = container.querySelector('button[aria-label="Rename"]');
    expect(renameBtn).not.toBeNull();
    if (!(renameBtn instanceof HTMLElement))
      throw new Error("renameBtn is not an HTMLElement");
    await userEvent.click(renameBtn);
    await flush();

    const input = container.querySelector("input:not([placeholder])");
    expect(input).not.toBeNull();
    if (!(input instanceof HTMLInputElement))
      throw new Error("input is not an HTMLInputElement");
    await userEvent.fill(input, "renamed.ts");
    await userEvent.keyboard("{Enter}");
    await flush();

    expect(store.listFiles()).not.toContain("/src/main.ts");
    expect(store.listFiles()).toContain("/src/renamed.ts");
    expect(store.readFile("/src/renamed.ts")).toBe("hello");
  });

  it("[test-delete] delete removes file from store", async () => {
    const store = new MemoryFileStore({
      "/src/main.ts": "",
      "/src/other.ts": "",
    });
    const { container, cleanup: c } = mountTree(store);
    cleanup = c;

    await waitForRender(container);

    const srcRow = await waitForRow(container, "src");
    srcRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    const mainRow = await waitForRow(container, "main.ts");
    await userEvent.hover(mainRow);
    await flush();

    const deleteBtn = container.querySelector('button[aria-label="Delete"]');
    expect(deleteBtn).not.toBeNull();
    if (!(deleteBtn instanceof HTMLElement))
      throw new Error("deleteBtn is not an HTMLElement");
    await userEvent.click(deleteBtn);
    await flush();

    expect(store.listFiles()).not.toContain("/src/main.ts");
    expect(store.listFiles()).toContain("/src/other.ts");
  });

  it("[test-reactive] tree updates when store gets new file", async () => {
    const store = new MemoryFileStore({ "/src/main.ts": "" });
    const { container, cleanup: c } = mountTree(store);
    cleanup = c;

    await waitForRender(container);

    const srcRow = await waitForRow(container, "src");
    srcRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    store.writeFile("/src/new.ts", "content");
    await flush();

    expect(container.textContent).toContain("new.ts");
  });
});
