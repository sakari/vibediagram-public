import { describe, expect, it, vi, beforeEach } from "vitest";
import { WorkerClient } from "./client.js";
import type { WorkerLike } from "./client.js";
import type { WorkerRequest, WorkerResponse, WorkerPush } from "./protocol.js";

function createMockWorker() {
  let handler: ((e: MessageEvent) => void) | null = null;
  const postMessage = vi.fn<(req: WorkerRequest) => void>();
  const worker: WorkerLike = {
    set onmessage(fn: ((e: MessageEvent) => void) | null) {
      handler = fn;
    },
    get onmessage() {
      return handler;
    },
    postMessage,
    terminate: vi.fn(),
  };
  function sendResponse(data: WorkerResponse | WorkerPush) {
    handler?.(new MessageEvent("message", { data }));
  }
  return { worker, postMessage, sendResponse };
}

function lastPostedId(
  postMessage: ReturnType<typeof vi.fn<(req: WorkerRequest) => void>>,
): string {
  const lastCall = postMessage.mock.calls[postMessage.mock.calls.length - 1];
  return lastCall[0].id;
}

describe("WorkerClient", () => {
  let client: WorkerClient;
  let postMessage: ReturnType<typeof vi.fn<(req: WorkerRequest) => void>>;
  let sendResponse: (data: WorkerResponse | WorkerPush) => void;

  beforeEach(() => {
    const mock = createMockWorker();
    client = new WorkerClient(mock.worker);
    postMessage = mock.postMessage;
    sendResponse = mock.sendResponse;
  });

  it("compile resolves with files and diagnostics", async () => {
    const promise = client.compile("/main.ts");
    const id = lastPostedId(postMessage);
    sendResponse({
      type: "compiled",
      id,
      files: [{ path: "/main.js", content: "var x = 1;" }],
      diagnostics: [],
    });
    const result = await promise;
    expect(result.files).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  it("error response rejects the pending promise", async () => {
    const promise = client.compile("/missing.ts");
    const id = lastPostedId(postMessage);
    sendResponse({ type: "error", id, message: "Source file not found" });
    await expect(promise).rejects.toThrow("Source file not found");
  });

  it("getCompletions resolves with completion array", async () => {
    const promise = client.getCompletions("/test.ts", 5);
    const id = lastPostedId(postMessage);
    sendResponse({
      type: "completions",
      id,
      completions: [
        { label: "foo", kind: "property" },
        { label: "bar", kind: "method" },
      ],
    });
    const result = await promise;
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("foo");
    expect(result[1].label).toBe("bar");
  });

  it("getQuickInfo resolves with text, start, length", async () => {
    const promise = client.getQuickInfo("/test.ts", 10);
    const id = lastPostedId(postMessage);
    sendResponse({
      type: "quickinfo",
      id,
      text: "const x: number",
      documentation: "A number variable.",
      tags: [{ name: "example", text: "const x = 1;" }],
      start: 6,
      length: 1,
    });
    const result = await promise;
    expect(result).toEqual({
      text: "const x: number",
      documentation: "A number variable.",
      tags: [{ name: "example", text: "const x = 1;" }],
      start: 6,
      length: 1,
    });
  });

  it("getQuickInfo resolves with null when text is empty", async () => {
    const promise = client.getQuickInfo("/test.ts", 10);
    const id = lastPostedId(postMessage);
    sendResponse({
      type: "quickinfo",
      id,
      text: "",
      documentation: "",
      tags: [],
      start: 0,
      length: 0,
    });
    const result = await promise;
    expect(result).toBeNull();
  });

  it("getDefinition resolves with targetPath and targetOffset", async () => {
    const promise = client.getDefinition("/b.ts", 20);
    const id = lastPostedId(postMessage);
    sendResponse({
      type: "definition",
      id,
      targetPath: "/a.ts",
      targetOffset: 5,
    });
    const result = await promise;
    expect(result).toEqual({ targetPath: "/a.ts", targetOffset: 5 });
  });

  it("getReferences resolves with references array", async () => {
    const promise = client.getReferences("/a.ts", 10);
    const id = lastPostedId(postMessage);
    const req = postMessage.mock.calls[postMessage.mock.calls.length - 1][0];
    expect(req).toEqual(
      expect.objectContaining({
        type: "get-references",
        path: "/a.ts",
        offset: 10,
      }),
    );
    sendResponse({
      type: "references",
      id,
      references: [
        { path: "/a.ts", start: 10, end: 17 },
        { path: "/b.ts", start: 5, end: 12 },
      ],
    });
    const result = await promise;
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/a.ts" }),
        expect.objectContaining({ path: "/b.ts" }),
      ]),
    );
  });

  it("getReferences rejects when response type is unexpected", async () => {
    const promise = client.getReferences("/a.ts", 0);
    const id = lastPostedId(postMessage);
    sendResponse({ type: "init-done", id, tsVersion: "5.0.0" });
    await expect(promise).rejects.toThrow("Unexpected response");
  });

  it("getDefinition resolves with null when targetPath is empty", async () => {
    const promise = client.getDefinition("/b.ts", 20);
    const id = lastPostedId(postMessage);
    sendResponse({ type: "definition", id, targetPath: "", targetOffset: 0 });
    const result = await promise;
    expect(result).toBeNull();
  });

  it("init resolves with tsVersion", async () => {
    const promise = client.init({});
    const id = lastPostedId(postMessage);
    sendResponse({ type: "init-done", id, tsVersion: "5.3.0" });
    const result = await promise;
    expect(result).toEqual({ tsVersion: "5.3.0" });
  });

  it("syncFile resolves on file-synced", async () => {
    const promise = client.syncFile("/test.ts", "const x = 1");
    const id = lastPostedId(postMessage);
    sendResponse({ type: "file-synced", id, path: "/test.ts" });
    await expect(promise).resolves.toBeUndefined();
  });

  it("deleteFile resolves on file-deleted", async () => {
    const promise = client.deleteFile("/test.ts");
    const id = lastPostedId(postMessage);
    sendResponse({ type: "file-deleted", id, path: "/test.ts" });
    await expect(promise).resolves.toBeUndefined();
  });

  it("getDiagnostics resolves with diagnostics array", async () => {
    const promise = client.getDiagnostics("/test.ts");
    const id = lastPostedId(postMessage);
    sendResponse({
      type: "diagnostics",
      id,
      path: "/test.ts",
      diagnostics: [{ message: "err", start: 0, end: 1, severity: "error" }],
    });
    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("err");
  });

  it("terminate calls worker.terminate", () => {
    const mock = createMockWorker();
    const c = new WorkerClient(mock.worker);
    c.terminate();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, not a real method
    expect(mock.worker.terminate).toHaveBeenCalled();
  });

  it("compile rejects when response type is unexpected", async () => {
    const promise = client.compile("/test.ts");
    const id = lastPostedId(postMessage);
    sendResponse({ type: "init-done", id, tsVersion: "5.0.0" });
    await expect(promise).rejects.toThrow("Unexpected response");
  });

  it("init rejects when response type is unexpected", async () => {
    const promise = client.init({});
    const id = lastPostedId(postMessage);
    sendResponse({
      type: "compiled",
      id,
      files: [],
      diagnostics: [],
    });
    await expect(promise).rejects.toThrow("Unexpected response");
  });

  it("getDiagnostics rejects when response type is unexpected", async () => {
    const promise = client.getDiagnostics("/test.ts");
    const id = lastPostedId(postMessage);
    sendResponse({ type: "init-done", id, tsVersion: "5.0.0" });
    await expect(promise).rejects.toThrow("Unexpected response");
  });

  it("getCompletions rejects when response type is unexpected", async () => {
    const promise = client.getCompletions("/test.ts", 0);
    const id = lastPostedId(postMessage);
    sendResponse({ type: "init-done", id, tsVersion: "5.0.0" });
    await expect(promise).rejects.toThrow("Unexpected response");
  });

  it("getQuickInfo rejects when response type is unexpected", async () => {
    const promise = client.getQuickInfo("/test.ts", 0);
    const id = lastPostedId(postMessage);
    sendResponse({ type: "init-done", id, tsVersion: "5.0.0" });
    await expect(promise).rejects.toThrow("Unexpected response");
  });

  it("getDefinition rejects when response type is unexpected", async () => {
    const promise = client.getDefinition("/test.ts", 0);
    const id = lastPostedId(postMessage);
    sendResponse({ type: "init-done", id, tsVersion: "5.0.0" });
    await expect(promise).rejects.toThrow("Unexpected response");
  });

  it("request times out after 30s", async () => {
    vi.useFakeTimers();
    const promise = client.compile("/test.ts");
    vi.advanceTimersByTime(30000);
    await expect(promise).rejects.toThrow("Worker request timed out");
    vi.useRealTimers();
  });

  it("diagnostics-updated push calls onDiagnosticsUpdated", () => {
    const handler = vi.fn();
    client.onDiagnosticsUpdated = handler;
    sendResponse({
      type: "diagnostics-updated",
      path: "/test.ts",
      diagnostics: [{ message: "err", start: 0, end: 1, severity: "error" }],
    });
    expect(handler).toHaveBeenCalledWith("/test.ts", [
      { message: "err", start: 0, end: 1, severity: "error" },
    ]);
  });
});
