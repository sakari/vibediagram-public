import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkerClient } from "@diagram/ts-worker";
import { MemoryFileStore } from "../store/MemoryFileStore.js";
import { EditorStateManager, diff } from "./EditorStateManager.js";

const mockDeleteFile = vi
  .fn<WorkerClient["deleteFile"]>()
  .mockResolvedValue(undefined);

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock: only public API methods are needed
const mockClient = {
  init: vi.fn<WorkerClient["init"]>().mockResolvedValue({ tsVersion: "" }),
  syncFile: vi.fn<WorkerClient["syncFile"]>().mockResolvedValue(undefined),
  deleteFile: mockDeleteFile,
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

interface CreateManagerResult {
  manager: EditorStateManager;
  store: MemoryFileStore;
}

function createManager(
  initialFiles?: Record<string, string>,
  options?: { readOnly?: boolean },
): CreateManagerResult {
  const store = new MemoryFileStore(initialFiles);
  const manager = new EditorStateManager(
    store,
    mockClient,
    () => {},
    () => {},
    undefined, // onContentChange
    undefined, // onReferences
    options?.readOnly,
  );
  return { manager, store };
}

function createMockView() {
  const scrollDOM = { scrollLeft: 0, scrollTop: 0 };
  const contentDOM = { focus: vi.fn() };
  let currentState = { doc: { toString: () => "" } };
  return {
    scrollDOM,
    contentDOM,
    get state() {
      return currentState;
    },
    setState: vi.fn((s: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock: narrowing to internal state shape
      currentState = s as typeof currentState;
    }),
    dispatch: vi.fn(),
  };
}

describe("EditorStateManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("openFile", () => {
    it("[test-open-file] Opening a file creates an EditorState and sets it as active tab", () => {
      const { manager } = createManager({ "/a.ts": "const x = 1" });
      manager.openFile("/a.ts");

      expect(manager.getOpenTabs()).toEqual(["/a.ts"]);
      expect(manager.getActiveTab()).toBe("/a.ts");
      expect(manager.getOpenTabs().length).toBe(1);
    });

    it("opening an already-open file switches to it without duplicating tabs", () => {
      const { manager } = createManager({
        "/a.ts": "a",
        "/b.ts": "b",
      });
      manager.openFile("/a.ts");
      manager.openFile("/b.ts");
      expect(manager.getActiveTab()).toBe("/b.ts");

      manager.openFile("/a.ts");
      expect(manager.getActiveTab()).toBe("/a.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts", "/b.ts"]);
    });

    it("opens a file not in the store using fallbackContent", () => {
      const { manager } = createManager({});
      manager.openFile("/lib.d.ts", "declare const x: number;");

      expect(manager.getOpenTabs()).toEqual(["/lib.d.ts"]);
      expect(manager.getDocContent("/lib.d.ts")).toBe(
        "declare const x: number;",
      );
    });

    it("opens a file with cursorOffset and dispatches selection", () => {
      const { manager } = createManager({});
      const mockView = createMockView();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion -- test mock
      manager.attachView(mockView as any);

      manager.openFile("/lib.d.ts", "declare const x: number;", 14);

      expect(manager.getOpenTabs()).toEqual(["/lib.d.ts"]);
      expect(mockView.dispatch).toHaveBeenCalled();
    });

    it("sets cursor when reopening an already-open file with cursorOffset", () => {
      const { manager } = createManager({ "/a.ts": "const a = 1" });
      const mockView = createMockView();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion -- test mock
      manager.attachView(mockView as any);

      manager.openFile("/a.ts");
      mockView.dispatch.mockClear();

      manager.openFile("/a.ts", undefined, 6);
      expect(mockView.dispatch).toHaveBeenCalled();
    });
  });

  describe("detachView", () => {
    it("detachView clears the view reference", () => {
      const { manager } = createManager({ "/a.ts": "a" });
      const mockView = createMockView();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion -- test mock
      manager.attachView(mockView as any);
      manager.detachView();
      // After detach, switching files should not call setState on the old view
      manager.openFile("/a.ts");
      expect(mockView.setState).not.toHaveBeenCalled();
    });
  });

  describe("switchToFile", () => {
    it("[test-switch-tabs] Switching tabs changes the active tab, preserves EditorState per file", () => {
      const { manager } = createManager({
        "/a.ts": "const a = 1",
        "/b.ts": "const b = 2",
      });
      manager.openFile("/a.ts");
      manager.openFile("/b.ts");

      expect(manager.getActiveTab()).toBe("/b.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts", "/b.ts"]);

      manager.switchToFile("/a.ts");
      expect(manager.getActiveTab()).toBe("/a.ts");
    });

    it("switchToFile creates state lazily for tab added via handleFileCreated", () => {
      const { manager } = createManager({ "/a.ts": "a", "/b.ts": "content b" });
      manager.openFile("/a.ts");

      // Add tab without state
      manager.handleFileCreated("/b.ts");
      expect(manager.getOpenTabs()).toContain("/b.ts");
      expect(manager.getDocContent("/b.ts")).toBeNull();

      // Switch forces lazy state creation
      manager.switchToFile("/b.ts");
      expect(manager.getActiveTab()).toBe("/b.ts");
      expect(manager.getDocContent("/b.ts")).toBe("content b");
    });

    it("switchToFile is a no-op for path not in tabs", () => {
      const { manager } = createManager({ "/a.ts": "a" });
      manager.openFile("/a.ts");
      manager.switchToFile("/nonexistent.ts");
      expect(manager.getActiveTab()).toBe("/a.ts");
    });

    it("switchToFile saves and restores scroll positions with an attached view", () => {
      const { manager } = createManager({
        "/a.ts": "a",
        "/b.ts": "b",
      });
      const mockView = createMockView();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion -- test mock
      manager.attachView(mockView as any);

      manager.openFile("/a.ts");
      // Simulate scroll
      mockView.scrollDOM.scrollLeft = 10;
      mockView.scrollDOM.scrollTop = 42;

      // Switch away saves scroll
      manager.openFile("/b.ts");

      // Switch back restores scroll
      manager.switchToFile("/a.ts");
      expect(mockView.scrollDOM.scrollLeft).toBe(10);
      expect(mockView.scrollDOM.scrollTop).toBe(42);
    });
  });

  describe("closeFile", () => {
    it("[test-close-tab] Closing a tab removes it, switches to another if it was active", () => {
      const { manager } = createManager({
        "/a.ts": "a",
        "/b.ts": "b",
        "/c.ts": "c",
      });
      manager.openFile("/a.ts");
      manager.openFile("/b.ts");
      manager.openFile("/c.ts");
      expect(manager.getActiveTab()).toBe("/c.ts");

      manager.closeFile("/c.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts", "/b.ts"]);
      expect(manager.getActiveTab()).toBe("/b.ts");

      manager.closeFile("/b.ts");
      expect(manager.getActiveTab()).toBe("/a.ts");

      manager.closeFile("/a.ts");
      expect(manager.getOpenTabs()).toEqual([]);
      expect(manager.getActiveTab()).toBe(null);
    });

    it("closing the last tab with an attached view resets to empty EditorState", () => {
      const { manager } = createManager({ "/a.ts": "a" });
      const mockView = createMockView();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion -- test mock
      manager.attachView(mockView as any);

      manager.openFile("/a.ts");
      manager.closeFile("/a.ts");

      expect(manager.getOpenTabs()).toEqual([]);
      expect(manager.getActiveTab()).toBe(null);
      // setState should have been called to reset (once for openFile switch, once for close)
      expect(mockView.setState).toHaveBeenCalled();
    });
  });

  describe("applyRemoteChange", () => {
    it("[test-remote-change] applyRemoteChange updates the file's EditorState content", () => {
      const { manager } = createManager({ "/a.ts": "hello" });
      manager.openFile("/a.ts");

      expect(manager.getDocContent("/a.ts")).toBe("hello");

      manager.applyRemoteChange("/a.ts", "hello world");

      expect(manager.getDocContent("/a.ts")).toBe("hello world");
    });

    it("applyRemoteChange is a no-op for non-open files", () => {
      const { manager } = createManager({ "/a.ts": "a" });
      // Don't open the file — state doesn't exist
      manager.applyRemoteChange("/a.ts", "changed");
      expect(manager.getDocContent("/a.ts")).toBeNull();
    });

    it("applyRemoteChange is a no-op when content is identical", () => {
      const { manager } = createManager({ "/a.ts": "same" });
      manager.openFile("/a.ts");
      manager.applyRemoteChange("/a.ts", "same");
      expect(manager.getDocContent("/a.ts")).toBe("same");
    });
  });

  describe("closeFile edge cases", () => {
    it("closeFile is a no-op for non-open files", () => {
      const { manager } = createManager({ "/a.ts": "a" });
      manager.openFile("/a.ts");
      manager.closeFile("/nonexistent.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts"]);
    });
  });

  describe("dispose", () => {
    it("dispose clears all state and unsubscribes", () => {
      const { manager, store } = createManager({ "/a.ts": "a" });
      manager.openFile("/a.ts");
      manager.subscribe();
      manager.dispose();

      expect(manager.getOpenTabs()).toEqual([]);
      expect(manager.getActiveTab()).toBeNull();
      expect(manager.getDocContent("/a.ts")).toBeNull();

      // After dispose, store events should not affect manager
      store.writeFile("/a.ts", "updated");
      expect(manager.getOpenTabs()).toEqual([]);
    });
  });

  describe("handleFileCreated", () => {
    it("[test-file-created] handleFileCreated adds to tabs", () => {
      const { manager } = createManager({ "/a.ts": "a" });
      manager.openFile("/a.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts"]);

      manager.handleFileCreated("/b.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts", "/b.ts"]);
    });
  });

  describe("handleFileDeleted", () => {
    it("[test-file-deleted] handleFileDeleted removes from tabs", () => {
      const { manager } = createManager({ "/a.ts": "a", "/b.ts": "b" });
      manager.openFile("/a.ts");

      manager.openFile("/b.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts", "/b.ts"]);

      manager.handleFileDeleted("/b.ts");
      expect(manager.getOpenTabs()).toEqual(["/a.ts"]);
      expect(mockDeleteFile).toHaveBeenCalledWith("/b.ts");
    });
  });

  describe("subscribe", () => {
    it("subscribe wires FileStore events to manager methods", () => {
      const { manager, store } = createManager({ "/a.ts": "a" });
      manager.openFile("/a.ts");
      manager.subscribe();

      // onFileChange triggers applyRemoteChange + syncFile
      store.writeFile("/a.ts", "updated");
      expect(manager.getDocContent("/a.ts")).toBe("updated");
      // eslint-disable-next-line @typescript-eslint/unbound-method -- mock function in expect
      expect(mockClient.syncFile).toHaveBeenCalledWith("/a.ts", "updated");

      // onFileCreated triggers handleFileCreated
      store.writeFile("/new.ts", "new content");
      expect(manager.getOpenTabs()).toContain("/new.ts");

      // onFileDeleted triggers handleFileDeleted
      store.deleteFile("/new.ts");
      expect(manager.getOpenTabs()).not.toContain("/new.ts");
      expect(mockDeleteFile).toHaveBeenCalledWith("/new.ts");
    });
  });
});

describe("readOnly mode", () => {
  it("opens files and manages tabs normally in read-only mode", () => {
    const { manager } = createManager(
      { "/a.ts": "const a = 1" },
      { readOnly: true },
    );
    manager.openFile("/a.ts");

    expect(manager.getOpenTabs()).toEqual(["/a.ts"]);
    expect(manager.getActiveTab()).toBe("/a.ts");
    expect(manager.getDocContent("/a.ts")).toBe("const a = 1");
  });

  it("supports close and switch in read-only mode", () => {
    const { manager } = createManager(
      { "/a.ts": "a", "/b.ts": "b" },
      { readOnly: true },
    );
    manager.openFile("/a.ts");
    manager.openFile("/b.ts");
    expect(manager.getActiveTab()).toBe("/b.ts");

    manager.closeFile("/b.ts");
    expect(manager.getActiveTab()).toBe("/a.ts");
    expect(manager.getOpenTabs()).toEqual(["/a.ts"]);
  });
});

describe("diff", () => {
  it("returns null when strings are identical", () => {
    expect(diff("abc", "abc")).toBeNull();
    expect(diff("", "")).toBeNull();
  });

  it("handles insert at start", () => {
    expect(diff("bc", "abc")).toEqual({
      from: 0,
      to: 0,
      insert: "a",
    });
  });

  it("handles insert at end", () => {
    expect(diff("ab", "abc")).toEqual({
      from: 2,
      to: 2,
      insert: "c",
    });
  });

  it("handles delete from start", () => {
    expect(diff("abc", "bc")).toEqual({
      from: 0,
      to: 1,
      insert: "",
    });
  });

  it("handles delete from end", () => {
    expect(diff("abc", "ab")).toEqual({
      from: 2,
      to: 3,
      insert: "",
    });
  });

  it("handles replace in middle", () => {
    expect(diff("hello world", "hello there")).toEqual({
      from: 6,
      to: 11,
      insert: "there",
    });
  });

  it("handles completely different strings", () => {
    expect(diff("abc", "xyz")).toEqual({
      from: 0,
      to: 3,
      insert: "xyz",
    });
  });
});
