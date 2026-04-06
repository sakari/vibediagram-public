import { describe, it, expect } from "vitest";
import { MemoryFileStore } from "./MemoryFileStore.js";

describe("MemoryFileStore", () => {
  it("listFiles returns file paths", () => {
    const store = new MemoryFileStore({ "/a.ts": "a", "/b.ts": "b" });
    expect(store.listFiles()).toEqual(["/a.ts", "/b.ts"]);
  });

  it("readFile returns content, undefined for missing files", () => {
    const store = new MemoryFileStore({ "/a.ts": "content" });
    expect(store.readFile("/a.ts")).toBe("content");
    expect(store.readFile("/missing.ts")).toBeUndefined();
  });

  it("writeFile creates and updates files", () => {
    const store = new MemoryFileStore();
    store.writeFile("/new.ts", "initial");
    expect(store.readFile("/new.ts")).toBe("initial");
    store.writeFile("/new.ts", "updated");
    expect(store.readFile("/new.ts")).toBe("updated");
  });

  it("deleteFile removes files", () => {
    const store = new MemoryFileStore({ "/a.ts": "a" });
    store.deleteFile("/a.ts");
    expect(store.readFile("/a.ts")).toBeUndefined();
    expect(store.listFiles()).toEqual([]);
  });

  it("onFileChange fires when writeFile updates existing file (not on create)", () => {
    const store = new MemoryFileStore({ "/a.ts": "old" });
    const changes: [string, string][] = [];
    store.onFileChange((path, content) => changes.push([path, content]));
    store.writeFile("/a.ts", "new");
    expect(changes).toEqual([["/a.ts", "new"]]);
    changes.length = 0;
    store.writeFile("/b.ts", "created");
    expect(changes).toEqual([]);
  });

  it("onFileCreated fires when writeFile creates a new file", () => {
    const store = new MemoryFileStore({ "/a.ts": "a" });
    const created: [string, string][] = [];
    store.onFileCreated((path, content) => created.push([path, content]));
    store.writeFile("/b.ts", "new file");
    expect(created).toEqual([["/b.ts", "new file"]]);
    created.length = 0;
    store.writeFile("/b.ts", "updated");
    expect(created).toEqual([]);
  });

  it("onFileDeleted fires when deleteFile is called", () => {
    const store = new MemoryFileStore({ "/a.ts": "a" });
    const deleted: string[] = [];
    store.onFileDeleted((path) => deleted.push(path));
    store.deleteFile("/a.ts");
    expect(deleted).toEqual(["/a.ts"]);
  });

  it("unsubscribe stops callbacks", () => {
    const store = new MemoryFileStore({ "/a.ts": "a" });
    const changes: string[] = [];
    const unsub = store.onFileChange((path) => changes.push(path));
    store.writeFile("/a.ts", "v1");
    expect(changes).toEqual(["/a.ts"]);
    unsub();
    store.writeFile("/a.ts", "v2");
    expect(changes).toEqual(["/a.ts"]);
  });

  it("deleteFile is a no-op for non-existent files", () => {
    const store = new MemoryFileStore();
    const deleted: string[] = [];
    store.onFileDeleted((path) => deleted.push(path));
    store.deleteFile("/missing.ts");
    expect(deleted).toEqual([]);
    expect(store.listFiles()).toEqual([]);
  });

  it("constructor without initial files creates empty store", () => {
    const store = new MemoryFileStore();
    expect(store.listFiles()).toEqual([]);
    expect(store.readFile("/any.ts")).toBeUndefined();
  });

  it("unsubscribe from onFileCreated stops callbacks", () => {
    const store = new MemoryFileStore();
    const created: string[] = [];
    const unsub = store.onFileCreated((path) => created.push(path));
    store.writeFile("/a.ts", "a");
    expect(created).toEqual(["/a.ts"]);
    unsub();
    store.writeFile("/b.ts", "b");
    expect(created).toEqual(["/a.ts"]);
  });

  it("unsubscribe from onFileDeleted stops callbacks", () => {
    const store = new MemoryFileStore({ "/a.ts": "a", "/b.ts": "b" });
    const deleted: string[] = [];
    const unsub = store.onFileDeleted((path) => deleted.push(path));
    store.deleteFile("/a.ts");
    expect(deleted).toEqual(["/a.ts"]);
    unsub();
    store.deleteFile("/b.ts");
    expect(deleted).toEqual(["/a.ts"]);
  });
});
