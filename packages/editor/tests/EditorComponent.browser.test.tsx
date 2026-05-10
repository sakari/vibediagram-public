import { describe, it, expect, afterEach } from "vitest";
import { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import {
  EditorComponent,
  type EditorHandle,
  MemoryFileStore,
} from "../src/index.js";

interface MountedEditor {
  ref: React.RefObject<EditorHandle>;
  root: Root;
  container: HTMLDivElement;
}

/**
 * Mounts EditorComponent into a fresh DOM container with a single file and
 * waits until the imperative handle exposes a non-null EditorView. Returning
 * the ref + cleanup primitives lets tests drive the component directly.
 */
async function mountEditor(): Promise<MountedEditor> {
  const container = document.createElement("div");
  // The editor measures its container, so it must be in the document.
  document.body.appendChild(container);

  const store = new MemoryFileStore({
    "/src/main.ts": "const x: number = 1;\n",
  });

  const ref = createRef<EditorHandle>();
  const root = createRoot(container);
  root.render(
    <EditorComponent ref={ref} fileStore={store} initialFile="/src/main.ts" />,
  );

  // The editor mounts asynchronously (worker init + view creation). Poll the
  // imperative handle rather than sleeping, so the test stays robust under load.
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const view = ref.current?.getEditorView() ?? null;
    if (view !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return { ref, root, container };
}

describe("EditorComponent imperative handle", () => {
  let mounted: MountedEditor | null = null;

  afterEach(() => {
    if (mounted) {
      const { root, container } = mounted;
      root.unmount();
      container.remove();
      mounted = null;
    }
  });

  it("[ec-handle-view] exposes the underlying CodeMirror EditorView after mount", async () => {
    mounted = await mountEditor();
    const view = mounted.ref.current?.getEditorView();
    expect(view).not.toBeNull();
    expect(view).toBeInstanceOf(EditorView);
  });

  it("[ec-handle-unmount] getEditorView remains callable after unmount", async () => {
    mounted = await mountEditor();
    const handle = mounted.ref.current;
    expect(handle).not.toBeNull();

    mounted.root.unmount();
    mounted.container.remove();
    mounted = null;

    // The handle reference may still be held by consumers after unmount. Calling
    // getEditorView() must not throw; the returned value is implementation-defined.
    expect(() => handle?.getEditorView()).not.toThrow();
  });
});
