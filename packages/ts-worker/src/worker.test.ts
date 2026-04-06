import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkerRequest, WorkerResponse, WorkerPush } from "./protocol.js";

/* ---------- mock LanguageServiceHost ----------------------------------- */
const mockHost = {
  initialize: vi
    .fn<
      (
        libFiles: Record<string, string>,
        opts?: Record<string, unknown>,
        extras?: { path: string; content: string }[],
      ) => string
    >()
    .mockReturnValue("5.0.0"),
  syncFile: vi.fn(),
  deleteFile: vi.fn(),
  getDiagnostics: vi
    .fn<
      (
        path: string,
      ) => { message: string; start: number; end: number; severity: string }[]
    >()
    .mockReturnValue([]),
  getCompletions: vi
    .fn<(path: string, offset: number) => { label: string; kind: string }[]>()
    .mockReturnValue([]),
  getQuickInfo: vi
    .fn<
      (
        path: string,
        offset: number,
      ) => {
        text: string;
        documentation: string;
        tags: { name: string; text: string }[];
        start: number;
        length: number;
      } | null
    >()
    .mockReturnValue(null),
  getDefinition: vi
    .fn<
      (
        path: string,
        offset: number,
      ) => { targetPath: string; targetOffset: number } | null
    >()
    .mockReturnValue(null),
  getReferences: vi
    .fn<
      (
        path: string,
        offset: number,
      ) => { path: string; start: number; end: number }[]
    >()
    .mockReturnValue([]),
  compile: vi
    .fn<
      (entry: string) => {
        files: { path: string; content: string }[];
        diagnostics: {
          message: string;
          start: number;
          end: number;
          severity: string;
        }[];
      }
    >()
    .mockReturnValue({ files: [], diagnostics: [] }),
  getKnownFiles: vi.fn<() => string[]>().mockReturnValue([]),
};

vi.mock("./language-service.js", () => ({
  LanguageServiceHost: vi.fn(() => mockHost),
}));

vi.mock("virtual:ts-lib-files", () => ({
  default: new Map<string, string>(),
}));

/* ---------- stub the global `self` as a minimal worker scope ----------- */
type MessageHandler = (e: MessageEvent<WorkerRequest>) => void;
let messageHandler: MessageHandler | null = null;
const posted: (WorkerResponse | WorkerPush)[] = [];

const fakeSelf = {
  addEventListener: (_event: string, handler: MessageHandler) => {
    messageHandler = handler;
  },
  postMessage: (msg: WorkerResponse | WorkerPush) => {
    posted.push(msg);
  },
};

vi.stubGlobal("self", fakeSelf);

/* Enable fake timers before importing the worker module so that
   setTimeout calls inside the module are always intercepted. */
vi.useFakeTimers();

/* Import the worker module — vi.mock and vi.stubGlobal are hoisted above
   this import by vitest, so mocks + global stub are in place. */
await import("./worker.js");

function dispatch(req: WorkerRequest): void {
  messageHandler!(new MessageEvent("message", { data: req }));
}

function lastPosted(): WorkerResponse | WorkerPush {
  return posted[posted.length - 1];
}

describe("worker message handler", () => {
  beforeEach(() => {
    // Flush any pending debounce timer from previous tests so the
    // module-level diagnosticsPushTimer resets to null.
    vi.runAllTimers();
    posted.length = 0;
    vi.clearAllMocks();
  });

  it("handles init and replies with init-done", () => {
    dispatch({
      type: "init",
      id: "1",
      compilerOptions: {},
    });
    expect(mockHost.initialize).toHaveBeenCalledWith({}, {}, undefined);
    expect(lastPosted()).toEqual({
      type: "init-done",
      id: "1",
      tsVersion: "5.0.0",
    });
  });

  it("handles init with extraLibs", () => {
    dispatch({
      type: "init",
      id: "2",
      compilerOptions: { strict: true },
      extraLibs: [
        { path: "/globals.d.ts", content: "declare const A: string" },
      ],
    });
    expect(mockHost.initialize).toHaveBeenCalledWith({}, { strict: true }, [
      { path: "/globals.d.ts", content: "declare const A: string" },
    ]);
  });

  it("handles sync-file and replies with file-synced", () => {
    dispatch({
      type: "sync-file",
      id: "3",
      path: "/a.ts",
      content: "const x = 1",
    });
    expect(mockHost.syncFile).toHaveBeenCalledWith("/a.ts", "const x = 1");
    expect(lastPosted()).toEqual({
      type: "file-synced",
      id: "3",
      path: "/a.ts",
    });
  });

  it("handles delete-file and replies with file-deleted", () => {
    dispatch({ type: "delete-file", id: "4", path: "/a.ts" });
    expect(mockHost.deleteFile).toHaveBeenCalledWith("/a.ts");
    expect(lastPosted()).toEqual({
      type: "file-deleted",
      id: "4",
      path: "/a.ts",
    });
  });

  it("handles get-diagnostics", () => {
    mockHost.getDiagnostics.mockReturnValueOnce([
      { message: "err", start: 0, end: 5, severity: "error" },
    ]);
    dispatch({ type: "get-diagnostics", id: "5", path: "/a.ts" });
    expect(lastPosted()).toEqual({
      type: "diagnostics",
      id: "5",
      path: "/a.ts",
      diagnostics: [{ message: "err", start: 0, end: 5, severity: "error" }],
    });
  });

  it("handles get-completions", () => {
    mockHost.getCompletions.mockReturnValueOnce([
      { label: "foo", kind: "property" },
    ]);
    dispatch({ type: "get-completions", id: "6", path: "/a.ts", offset: 10 });
    expect(mockHost.getCompletions).toHaveBeenCalledWith("/a.ts", 10);
    expect(lastPosted()).toEqual({
      type: "completions",
      id: "6",
      completions: [{ label: "foo", kind: "property" }],
    });
  });

  it("handles get-quickinfo with result", () => {
    mockHost.getQuickInfo.mockReturnValueOnce({
      text: "const x: number",
      documentation: "A count variable.",
      tags: [{ name: "example", text: "const count = 1;" }],
      start: 6,
      length: 1,
    });
    dispatch({ type: "get-quickinfo", id: "7", path: "/a.ts", offset: 6 });
    expect(lastPosted()).toEqual({
      type: "quickinfo",
      id: "7",
      text: "const x: number",
      documentation: "A count variable.",
      tags: [{ name: "example", text: "const count = 1;" }],
      start: 6,
      length: 1,
    });
  });

  it("handles get-quickinfo with null (returns empty fallback)", () => {
    mockHost.getQuickInfo.mockReturnValueOnce(null);
    dispatch({ type: "get-quickinfo", id: "8", path: "/a.ts", offset: 0 });
    expect(lastPosted()).toEqual({
      type: "quickinfo",
      id: "8",
      text: "",
      documentation: "",
      tags: [],
      start: 0,
      length: 0,
    });
  });

  it("handles get-definition with result", () => {
    mockHost.getDefinition.mockReturnValueOnce({
      targetPath: "/b.ts",
      targetOffset: 5,
    });
    dispatch({ type: "get-definition", id: "9", path: "/a.ts", offset: 10 });
    expect(lastPosted()).toEqual({
      type: "definition",
      id: "9",
      targetPath: "/b.ts",
      targetOffset: 5,
    });
  });

  it("handles get-definition with null (returns empty fallback)", () => {
    mockHost.getDefinition.mockReturnValueOnce(null);
    dispatch({ type: "get-definition", id: "10", path: "/a.ts", offset: 0 });
    expect(lastPosted()).toEqual({
      type: "definition",
      id: "10",
      targetPath: "",
      targetOffset: 0,
    });
  });

  it("handles get-references with results", () => {
    mockHost.getReferences.mockReturnValueOnce([
      { path: "/a.ts", start: 0, end: 7 },
      { path: "/b.ts", start: 10, end: 17 },
    ]);
    dispatch({ type: "get-references", id: "14", path: "/a.ts", offset: 3 });
    expect(mockHost.getReferences).toHaveBeenCalledWith("/a.ts", 3);
    expect(lastPosted()).toEqual({
      type: "references",
      id: "14",
      references: [
        { path: "/a.ts", start: 0, end: 7 },
        { path: "/b.ts", start: 10, end: 17 },
      ],
    });
  });

  it("handles get-references with no results", () => {
    mockHost.getReferences.mockReturnValueOnce([]);
    dispatch({ type: "get-references", id: "15", path: "/a.ts", offset: 0 });
    expect(lastPosted()).toEqual({
      type: "references",
      id: "15",
      references: [],
    });
  });

  it("handles compile", () => {
    mockHost.compile.mockReturnValueOnce({
      files: [{ path: "/main.js", content: "var x = 1;" }],
      diagnostics: [],
    });
    dispatch({ type: "compile", id: "11", entryPath: "/main.ts" });
    expect(mockHost.compile).toHaveBeenCalledWith("/main.ts");
    expect(lastPosted()).toEqual({
      type: "compiled",
      id: "11",
      files: [{ path: "/main.js", content: "var x = 1;" }],
      diagnostics: [],
    });
  });

  it("posts error response when handleRequest throws", () => {
    mockHost.compile.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    dispatch({ type: "compile", id: "12", entryPath: "/crash.ts" });
    expect(lastPosted()).toEqual({ type: "error", id: "12", message: "boom" });
  });

  it("posts error with stringified non-Error throw", () => {
    mockHost.compile.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- testing non-Error throw path
      throw "string error";
    });
    dispatch({ type: "compile", id: "13", entryPath: "/crash.ts" });
    expect(lastPosted()).toEqual({
      type: "error",
      id: "13",
      message: "string error",
    });
  });
});

describe("diagnostics push debounce", () => {
  beforeEach(() => {
    vi.runAllTimers();
    posted.length = 0;
    vi.clearAllMocks();
  });

  it("pushes diagnostics for files with errors after debounce", () => {
    mockHost.getKnownFiles.mockReturnValue(["/a.ts"]);
    mockHost.getDiagnostics.mockReturnValue([
      { message: "err", start: 0, end: 1, severity: "error" },
    ]);

    dispatch({ type: "sync-file", id: "20", path: "/a.ts", content: "bad" });
    // The file-synced response is immediate
    expect(posted).toHaveLength(1);

    vi.advanceTimersByTime(300);
    // After debounce, a diagnostics-updated push should appear
    const push = posted.find((m) => m.type === "diagnostics-updated");
    expect(push).toBeDefined();
    expect(push).toEqual({
      type: "diagnostics-updated",
      path: "/a.ts",
      diagnostics: [{ message: "err", start: 0, end: 1, severity: "error" }],
    });
  });

  it("does not push diagnostics for files with no errors", () => {
    mockHost.getKnownFiles.mockReturnValue(["/ok.ts"]);
    mockHost.getDiagnostics.mockReturnValue([]);

    dispatch({
      type: "sync-file",
      id: "21",
      path: "/ok.ts",
      content: "const x = 1",
    });
    vi.advanceTimersByTime(300);

    const pushes = posted.filter((m) => m.type === "diagnostics-updated");
    expect(pushes).toHaveLength(0);
  });

  it("debounces multiple sync-file calls into one push", () => {
    mockHost.getKnownFiles.mockReturnValue(["/a.ts"]);
    mockHost.getDiagnostics.mockReturnValue([
      { message: "err", start: 0, end: 1, severity: "error" },
    ]);

    dispatch({ type: "sync-file", id: "22", path: "/a.ts", content: "v1" });
    dispatch({ type: "sync-file", id: "23", path: "/a.ts", content: "v2" });
    dispatch({ type: "sync-file", id: "24", path: "/a.ts", content: "v3" });

    vi.advanceTimersByTime(300);
    const pushes = posted.filter((m) => m.type === "diagnostics-updated");
    // Only one diagnostics push despite 3 sync-file calls
    expect(pushes).toHaveLength(1);
  });

  it("delete-file also schedules a diagnostics push", () => {
    mockHost.getKnownFiles.mockReturnValue(["/b.ts"]);
    mockHost.getDiagnostics.mockReturnValue([
      { message: "err", start: 0, end: 1, severity: "error" },
    ]);

    dispatch({ type: "delete-file", id: "25", path: "/a.ts" });
    vi.advanceTimersByTime(300);

    const pushes = posted.filter((m) => m.type === "diagnostics-updated");
    expect(pushes).toHaveLength(1);
  });
});
