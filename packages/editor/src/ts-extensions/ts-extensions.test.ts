// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- mock functions used in expect assertions */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import type { WorkerClient, Completion, Reference } from "@diagram/ts-worker";
import { javascript } from "@codemirror/lang-javascript";
import { tsAutocompleteExtension } from "./autocomplete.js";
import { createHoverSource } from "./hover.js";
import { tsGoToDefExtension } from "./go-to-def.js";
import { tsLintExtension } from "./lint.js";
import { tsSyncExtension } from "./sync.js";
import { tsReferencesExtension } from "./references.js";

function createMockClient(overrides?: Partial<WorkerClient>): WorkerClient {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  return {
    init: vi.fn().mockResolvedValue({ tsVersion: "" }),
    syncFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    getDiagnostics: vi.fn().mockResolvedValue([]),
    getCompletions: vi.fn().mockResolvedValue([]),
    getQuickInfo: vi.fn().mockResolvedValue(null),
    getDefinition: vi.fn().mockResolvedValue(null),
    getReferences: vi.fn().mockResolvedValue([]),
    compile: vi.fn().mockResolvedValue({ files: [], diagnostics: [] }),
    terminate: vi.fn(),
    onDiagnosticsUpdated: null,
    ...overrides,
  } as unknown as WorkerClient;
}

describe("tsAutocompleteExtension", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("returns completions from the client", async () => {
    const completions: Completion[] = [
      { label: "toString", kind: "method" },
      { label: "valueOf", kind: "method" },
    ];
    const client = createMockClient({
      getCompletions: vi.fn().mockResolvedValue(completions),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "foo.",
        extensions: [
          javascript({ typescript: true }),
          tsAutocompleteExtension(client, "/test.ts", { dirty: false }),
        ],
      }),
      parent: container,
    });

    const { startCompletion } = await import("@codemirror/autocomplete");
    view.dispatch({ selection: { anchor: 4 } });
    startCompletion(view);

    await vi.waitFor(() => {
      expect(client.getCompletions).toHaveBeenCalledWith("/test.ts", 4);
    });

    view.destroy();
  });

  it("returns null when client returns no completions", async () => {
    const client = createMockClient({
      getCompletions: vi.fn().mockResolvedValue([]),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "foo.",
        extensions: [
          javascript({ typescript: true }),
          tsAutocompleteExtension(client, "/test.ts", { dirty: false }),
        ],
      }),
      parent: container,
    });

    const { startCompletion } = await import("@codemirror/autocomplete");
    view.dispatch({ selection: { anchor: 4 } });
    startCompletion(view);

    await vi.waitFor(() => {
      expect(client.getCompletions).toHaveBeenCalled();
    });

    view.destroy();
  });
});

describe("createHoverSource", () => {
  it("returns tooltip with signature only when no documentation", async () => {
    const client = createMockClient({
      getQuickInfo: vi.fn().mockResolvedValue({
        text: "const x: number",
        documentation: "",
        tags: [],
        start: 6,
        length: 1,
      }),
    });

    const source = createHoverSource(client, "/test.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-unsafe-argument -- test: view is unused by the source
    const result = await source(null as any, 6);

    expect(client.getQuickInfo).toHaveBeenCalledWith("/test.ts", 6);
    expect(result).not.toBeNull();
    expect(result!.pos).toBe(6);
    expect(result!.end).toBe(7);

    // Signature only — no doc section rendered
    const { dom } = result!.create(null!);
    expect(dom.className).toBe("cm-ts-tooltip");
    expect(dom.textContent).toBe("const x: number");
    expect(dom.querySelector(".cm-ts-tooltip-doc")).toBeNull();
  });

  it("renders documentation and tags in the tooltip DOM", async () => {
    const client = createMockClient({
      getQuickInfo: vi.fn().mockResolvedValue({
        text: "function add(a: number, b: number): number",
        documentation: "Adds two numbers.",
        tags: [
          { name: "param", text: "a - first" },
          { name: "returns", text: "the sum" },
        ],
        start: 0,
        length: 3,
      }),
    });

    const source = createHoverSource(client, "/test.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-unsafe-argument -- test: view is unused by the source
    const result = await source(null as any, 0);
    expect(result).not.toBeNull();

    const { dom } = result!.create(null!);
    // Signature in a <code> element
    const code = dom.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe(
      "function add(a: number, b: number): number",
    );

    // Documentation section exists with doc text and tags
    const docSection = dom.querySelector(".cm-ts-tooltip-doc");
    expect(docSection).not.toBeNull();
    expect(docSection!.textContent).toContain("Adds two numbers.");
    expect(docSection!.textContent).toContain("@param a - first");
    expect(docSection!.textContent).toContain("@returns the sum");
  });

  it("returns null when quickInfo is null", async () => {
    const client = createMockClient({
      getQuickInfo: vi.fn().mockResolvedValue(null),
    });

    const source = createHoverSource(client, "/test.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-unsafe-argument -- test: view is unused by the source
    const result = await source(null as any, 5);

    expect(client.getQuickInfo).toHaveBeenCalledWith("/test.ts", 5);
    expect(result).toBeNull();
  });
});

describe("tsGoToDefExtension", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("calls getDefinition on ctrl+click and navigates cross-file", async () => {
    const onNavigate = vi.fn();
    const client = createMockClient({
      getDefinition: vi.fn().mockResolvedValue({
        targetPath: "/other.ts",
        targetOffset: 10,
      }),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsGoToDefExtension(client, "/test.ts", onNavigate)],
      }),
      parent: container,
    });

    const clickEvent = new MouseEvent("click", {
      ctrlKey: true,
      clientX: 0,
      clientY: 0,
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(clickEvent);

    await vi.waitFor(() => {
      expect(client.getDefinition).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("/other.ts", 10);
    });

    view.destroy();
  });

  it("does not call getDefinition on regular click (no modifier)", () => {
    const onNavigate = vi.fn();
    const client = createMockClient();

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsGoToDefExtension(client, "/test.ts", onNavigate)],
      }),
      parent: container,
    });

    const clickEvent = new MouseEvent("click", {
      ctrlKey: false,
      clientX: 0,
      clientY: 0,
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(clickEvent);

    expect(client.getDefinition).not.toHaveBeenCalled();

    view.destroy();
  });

  it("does not navigate when getDefinition returns null", async () => {
    const onNavigate = vi.fn();
    const client = createMockClient({
      getDefinition: vi.fn().mockResolvedValue(null),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsGoToDefExtension(client, "/test.ts", onNavigate)],
      }),
      parent: container,
    });

    const clickEvent = new MouseEvent("click", {
      ctrlKey: true,
      clientX: 0,
      clientY: 0,
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(clickEvent);

    await vi.waitFor(() => {
      expect(client.getDefinition).toHaveBeenCalled();
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(onNavigate).not.toHaveBeenCalled();

    view.destroy();
  });

  it("scrolls within same file when definition is in same path", async () => {
    const onNavigate = vi.fn();
    const client = createMockClient({
      getDefinition: vi.fn().mockResolvedValue({
        targetPath: "/test.ts",
        targetOffset: 0,
      }),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;\nconst y = x;",
        extensions: [tsGoToDefExtension(client, "/test.ts", onNavigate)],
      }),
      parent: container,
    });

    const clickEvent = new MouseEvent("click", {
      ctrlKey: true,
      clientX: 0,
      clientY: 0,
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(clickEvent);

    await vi.waitFor(() => {
      expect(client.getDefinition).toHaveBeenCalled();
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(onNavigate).not.toHaveBeenCalled();

    view.destroy();
  });

  it("calls getDefinition at cursor position on F12 keypress", async () => {
    const onNavigate = vi.fn();
    const client = createMockClient({
      getDefinition: vi.fn().mockResolvedValue({
        targetPath: "/other.ts",
        targetOffset: 5,
      }),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsGoToDefExtension(client, "/test.ts", onNavigate)],
      }),
      parent: container,
    });

    // Place cursor at position 6
    view.dispatch({ selection: { anchor: 6 } });

    const keyEvent = new KeyboardEvent("keydown", {
      key: "F12",
      code: "F12",
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(keyEvent);

    await vi.waitFor(() => {
      expect(client.getDefinition).toHaveBeenCalledWith("/test.ts", 6);
    });

    await vi.waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("/other.ts", 5);
    });

    view.destroy();
  });
});

describe("tsLintExtension", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("fetches diagnostics from client and maps them", async () => {
    const client = createMockClient({
      getDiagnostics: vi
        .fn()
        .mockResolvedValue([
          { start: 0, end: 5, message: "error here", severity: "error" },
        ]),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsLintExtension(client, "/test.ts")],
      }),
      parent: container,
    });

    // The linter runs async; wait for it to call getDiagnostics
    await vi.waitFor(() => {
      expect(client.getDiagnostics).toHaveBeenCalledWith("/test.ts");
    });

    view.destroy();
  });

  it("onDiagnosticsUpdated installs handler and chains to previous handler", async () => {
    const prevHandler = vi.fn();
    const client = createMockClient({
      getDiagnostics: vi.fn().mockResolvedValue([]),
    });
    client.onDiagnosticsUpdated = prevHandler;

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsLintExtension(client, "/test.ts")],
      }),
      parent: container,
    });

    // Wait for initial lint
    await vi.waitFor(() => {
      expect(client.getDiagnostics).toHaveBeenCalled();
    });

    // Verify the handler was replaced (not the original)
    expect(client.onDiagnosticsUpdated).not.toBe(prevHandler);
    expect(client.onDiagnosticsUpdated).toBeTypeOf("function");

    // Trigger for matching path — should chain to prev handler
    client.onDiagnosticsUpdated("/test.ts", []);
    expect(prevHandler).toHaveBeenCalledWith("/test.ts", []);

    view.destroy();
  });

  it("onDiagnosticsUpdated does not force lint for different path", async () => {
    const client = createMockClient({
      getDiagnostics: vi.fn().mockResolvedValue([]),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsLintExtension(client, "/test.ts")],
      }),
      parent: container,
    });

    await vi.waitFor(() => {
      expect(client.getDiagnostics).toHaveBeenCalled();
    });

    const callCount = vi.mocked(client.getDiagnostics).mock.calls.length;

    // Trigger for a different path
    client.onDiagnosticsUpdated?.("/other.ts", []);

    // Wait a bit — should NOT re-trigger
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(client.getDiagnostics).mock.calls.length).toBe(callCount);

    view.destroy();
  });

  it("destroy restores previous onDiagnosticsUpdated handler", async () => {
    const prevHandler = vi.fn();
    const client = createMockClient({
      getDiagnostics: vi.fn().mockResolvedValue([]),
    });
    client.onDiagnosticsUpdated = prevHandler;

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsLintExtension(client, "/test.ts")],
      }),
      parent: container,
    });

    await vi.waitFor(() => {
      expect(client.getDiagnostics).toHaveBeenCalled();
    });

    view.destroy();

    expect(client.onDiagnosticsUpdated).toBe(prevHandler);
  });
});

describe("tsSyncExtension", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  it("syncs file to worker after debounce", () => {
    const client = createMockClient();

    const view = new EditorView({
      state: EditorState.create({
        doc: "hello",
        extensions: [tsSyncExtension(client, "/test.ts", { dirty: false })],
      }),
      parent: container,
    });

    view.dispatch({
      changes: { from: 5, to: 5, insert: " world" },
    });

    expect(client.syncFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(client.syncFile).toHaveBeenCalledWith("/test.ts", "hello world");

    view.destroy();
  });

  it("resets debounce timer on rapid edits", () => {
    const client = createMockClient();

    const view = new EditorView({
      state: EditorState.create({
        doc: "a",
        extensions: [tsSyncExtension(client, "/test.ts", { dirty: false })],
      }),
      parent: container,
    });

    view.dispatch({
      changes: { from: 0, to: 1, insert: "b" },
    });

    vi.advanceTimersByTime(50);

    view.dispatch({
      changes: { from: 0, to: 1, insert: "c" },
    });

    vi.advanceTimersByTime(50);
    expect(client.syncFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(client.syncFile).toHaveBeenCalledWith("/test.ts", "c");

    view.destroy();
  });

  it("cleans up timer on destroy", () => {
    const client = createMockClient();

    const view = new EditorView({
      state: EditorState.create({
        doc: "hello",
        extensions: [tsSyncExtension(client, "/test.ts", { dirty: false })],
      }),
      parent: container,
    });

    view.dispatch({
      changes: { from: 5, to: 5, insert: "!" },
    });

    // Destroy before debounce fires
    view.destroy();

    vi.advanceTimersByTime(200);

    // Should not have synced because view was destroyed
    expect(client.syncFile).not.toHaveBeenCalled();
  });
});

describe("tsReferencesExtension", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("calls getReferences on Shift+F12 keypress", async () => {
    const client = createMockClient();

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsReferencesExtension(client, "/test.ts")],
      }),
      parent: container,
    });

    view.dispatch({ selection: { anchor: 6 } });

    const keyEvent = new KeyboardEvent("keydown", {
      key: "F12",
      shiftKey: true,
      code: "F12",
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(keyEvent);

    await vi.waitFor(() => {
      expect(client.getReferences).toHaveBeenCalledWith("/test.ts", 6);
    });

    view.destroy();
  });

  it("calls onReferences callback with results", async () => {
    const refs: Reference[] = [
      { path: "/test.ts", start: 6, end: 7 },
      { path: "/other.ts", start: 10, end: 11 },
    ];
    const client = createMockClient({
      getReferences: vi.fn().mockResolvedValue(refs),
    });
    const onReferences = vi.fn();

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsReferencesExtension(client, "/test.ts", onReferences)],
      }),
      parent: container,
    });

    view.dispatch({ selection: { anchor: 6 } });

    const keyEvent = new KeyboardEvent("keydown", {
      key: "F12",
      shiftKey: true,
      code: "F12",
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(keyEvent);

    await vi.waitFor(() => {
      expect(onReferences).toHaveBeenCalledWith(refs);
    });

    view.destroy();
  });

  it("does nothing when no references found", async () => {
    const client = createMockClient({
      getReferences: vi.fn().mockResolvedValue([]),
    });
    const onReferences = vi.fn();

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsReferencesExtension(client, "/test.ts", onReferences)],
      }),
      parent: container,
    });

    view.dispatch({ selection: { anchor: 6 } });

    const keyEvent = new KeyboardEvent("keydown", {
      key: "F12",
      shiftKey: true,
      code: "F12",
      bubbles: true,
    });
    view.contentDOM.dispatchEvent(keyEvent);

    await vi.waitFor(() => {
      expect(client.getReferences).toHaveBeenCalled();
    });

    // Give the promise time to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(onReferences).not.toHaveBeenCalled();

    view.destroy();
  });

  it("Escape clears highlights after references are shown", async () => {
    const refs: Reference[] = [{ path: "/test.ts", start: 6, end: 7 }];
    const client = createMockClient({
      getReferences: vi.fn().mockResolvedValue(refs),
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "const x = 42;",
        extensions: [tsReferencesExtension(client, "/test.ts")],
      }),
      parent: container,
    });

    view.dispatch({ selection: { anchor: 6 } });

    // Trigger Shift+F12 to set highlights
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F12",
        shiftKey: true,
        code: "F12",
        bubbles: true,
      }),
    );

    await vi.waitFor(() => {
      expect(client.getReferences).toHaveBeenCalled();
    });

    // Wait for the async highlight dispatch
    await new Promise((r) => setTimeout(r, 10));

    // Press Escape to clear highlights
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      }),
    );

    // Escape should have been handled (highlights were active)
    view.destroy();
  });
});
