import { describe, it, expect, afterEach } from "vitest";
import { createTestEditor } from "./helpers.js";

describe("collaborative editing in browser", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  it("remote file change updates editor content", async () => {
    const {
      store,
      view,
      cleanup: c,
    } = await createTestEditor(
      {
        "/src/main.ts": "const x = 1;\n",
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    store.writeFile("/src/main.ts", "const x = 42;\n");

    await new Promise((r) => setTimeout(r, 50));

    const content = view.state.doc.toString();
    expect(content).toBe("const x = 42;\n");
  });

  it("remote change preserves cursor position", async () => {
    const initial = "const x = 1;\nconst y = 2;\n";
    const {
      store,
      view,
      cleanup: c,
    } = await createTestEditor(
      {
        "/src/main.ts": initial,
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    view.dispatch({ selection: { anchor: 14 } });
    expect(view.state.selection.main.head).toBe(14);

    store.writeFile("/src/main.ts", "// comment\nconst x = 1;\nconst y = 2;\n");

    await new Promise((r) => setTimeout(r, 50));

    const newPos = view.state.selection.main.head;
    expect(newPos).toBe(25);
  });
});
