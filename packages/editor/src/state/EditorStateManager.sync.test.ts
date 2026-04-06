// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import type { WorkerClient } from "@diagram/ts-worker";
import { MemoryFileStore } from "../store/MemoryFileStore.js";
import { EditorStateManager } from "./EditorStateManager.js";

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock: only public API methods are needed
const mockClient = {
  init: vi.fn<WorkerClient["init"]>().mockResolvedValue({ tsVersion: "" }),
  syncFile: vi.fn<WorkerClient["syncFile"]>().mockResolvedValue(undefined),
  deleteFile: vi.fn<WorkerClient["deleteFile"]>().mockResolvedValue(undefined),
  getDiagnostics: vi.fn<WorkerClient["getDiagnostics"]>().mockResolvedValue([]),
  getCompletions: vi.fn<WorkerClient["getCompletions"]>().mockResolvedValue([]),
  getQuickInfo: vi.fn<WorkerClient["getQuickInfo"]>().mockResolvedValue(null),
  getDefinition: vi.fn<WorkerClient["getDefinition"]>().mockResolvedValue(null),
  compile: vi
    .fn<WorkerClient["compile"]>()
    .mockResolvedValue({ files: [], diagnostics: [] }),
  terminate: vi.fn(),
  onDiagnosticsUpdated: null,
} as unknown as WorkerClient;

describe("fileStoreSyncExtension", () => {
  let store: MemoryFileStore;
  let manager: EditorStateManager;
  let view: EditorView;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    store = new MemoryFileStore({ "/a.ts": "const x = 1" });
    manager = new EditorStateManager(
      store,
      mockClient,
      () => {},
      () => {},
    );

    container = document.createElement("div");
    document.body.appendChild(container);

    view = new EditorView({
      state: EditorState.create(),
      parent: container,
    });

    manager.attachView(view);
    manager.openFile("/a.ts");
  });

  afterEach(() => {
    manager.dispose();
    view.destroy();
    container.remove();
    vi.useRealTimers();
  });

  it("[test-sync-debounce] writes editor changes to FileStore after 300ms debounce", () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "const y = 2" },
    });

    expect(store.readFile("/a.ts")).toBe("const x = 1");

    vi.advanceTimersByTime(300);

    expect(store.readFile("/a.ts")).toBe("const y = 2");
  });

  it("[test-sync-coalesce] coalesces rapid edits into a single write", () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "a" },
    });

    vi.advanceTimersByTime(100);

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "b" },
    });

    vi.advanceTimersByTime(100);

    expect(store.readFile("/a.ts")).toBe("const x = 1");

    vi.advanceTimersByTime(200);

    expect(store.readFile("/a.ts")).toBe("b");
  });

  it("[test-sync-skip-remote] does not write back remote changes", () => {
    manager.applyRemoteChange("/a.ts", "remote update");

    vi.advanceTimersByTime(500);

    expect(store.readFile("/a.ts")).toBe("const x = 1");
  });
});
