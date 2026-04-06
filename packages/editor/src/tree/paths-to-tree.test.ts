import { describe, it, expect } from "vitest";
import { buildTreeData } from "./paths-to-tree.js";

describe("buildTreeData", () => {
  it("basic: root children, /src children, /src/utils children, correct name/path/isFolder", () => {
    const tree = buildTreeData([
      "/src/main.ts",
      "/src/utils/math.ts",
      "/src/utils/format.ts",
      "/README.md",
    ]);

    expect(tree.rootItemId).toBe("/");
    expect(tree.getChildren("/")).toEqual(["/src", "/README.md"]);
    expect(tree.getChildren("/src")).toEqual(["/src/utils", "/src/main.ts"]);
    expect(tree.getChildren("/src/utils")).toEqual([
      "/src/utils/format.ts",
      "/src/utils/math.ts",
    ]);

    expect(tree.getItem("/")).toEqual({ name: "", path: "/", isFolder: true });
    expect(tree.getItem("/src")).toEqual({
      name: "src",
      path: "/src",
      isFolder: true,
    });
    expect(tree.getItem("/src/utils")).toEqual({
      name: "utils",
      path: "/src/utils",
      isFolder: true,
    });
    expect(tree.getItem("/src/main.ts")).toEqual({
      name: "main.ts",
      path: "/src/main.ts",
      isFolder: false,
    });
    expect(tree.getItem("/src/utils/math.ts")).toEqual({
      name: "math.ts",
      path: "/src/utils/math.ts",
      isFolder: false,
    });
    expect(tree.getItem("/src/utils/format.ts")).toEqual({
      name: "format.ts",
      path: "/src/utils/format.ts",
      isFolder: false,
    });
    expect(tree.getItem("/README.md")).toEqual({
      name: "README.md",
      path: "/README.md",
      isFolder: false,
    });
  });

  it("single-file: root has one child", () => {
    const tree = buildTreeData(["/index.ts"]);
    expect(tree.getChildren("/")).toEqual(["/index.ts"]);
    expect(tree.getItem("/index.ts")).toEqual({
      name: "index.ts",
      path: "/index.ts",
      isFolder: false,
    });
  });

  it("deep-nesting: 4 directory nodes and 1 file node", () => {
    const tree = buildTreeData(["/a/b/c/d/e.ts"]);
    const rootChildren = tree.getChildren("/");
    expect(rootChildren).toEqual(["/a"]);
    expect(tree.getChildren("/a")).toEqual(["/a/b"]);
    expect(tree.getChildren("/a/b")).toEqual(["/a/b/c"]);
    expect(tree.getChildren("/a/b/c")).toEqual(["/a/b/c/d"]);
    expect(tree.getChildren("/a/b/c/d")).toEqual(["/a/b/c/d/e.ts"]);

    expect(tree.getItem("/a").isFolder).toBe(true);
    expect(tree.getItem("/a/b").isFolder).toBe(true);
    expect(tree.getItem("/a/b/c").isFolder).toBe(true);
    expect(tree.getItem("/a/b/c/d").isFolder).toBe(true);
    expect(tree.getItem("/a/b/c/d/e.ts").isFolder).toBe(false);
  });

  it("empty: root has no children", () => {
    const tree = buildTreeData([]);
    expect(tree.getChildren("/")).toEqual([]);
    expect(tree.rootItemId).toBe("/");
  });

  it("sorting: directories before files, alphabetical within groups", () => {
    const tree = buildTreeData([
      "/root/bbb.ts",
      "/root/aaa.ts",
      "/root/subdir/foo.ts",
      "/root/zzz.ts",
    ]);
    const rootChildren = tree.getChildren("/root");
    expect(rootChildren).toEqual([
      "/root/subdir",
      "/root/aaa.ts",
      "/root/bbb.ts",
      "/root/zzz.ts",
    ]);
  });

  it("skips empty-segment paths gracefully", () => {
    const tree = buildTreeData(["", "/a.ts"]);
    expect(tree.getChildren("/")).toEqual(["/a.ts"]);
  });

  it("getItem throws for unknown item", () => {
    const tree = buildTreeData(["/a.ts"]);
    expect(() => tree.getItem("/nonexistent")).toThrow("Unknown item");
  });

  describe("readOnlyPaths", () => {
    it("marks read-only leaf nodes with readOnly: true", () => {
      const tree = buildTreeData(["/main.ts"], ["/types/sim.d.ts"]);
      expect(tree.getItem("/types/sim.d.ts")).toEqual(
        expect.objectContaining({ readOnly: true, isFolder: false }),
      );
    });

    it("regular paths have no readOnly property set", () => {
      const tree = buildTreeData(["/main.ts"], ["/types/sim.d.ts"]);
      expect(tree.getItem("/main.ts").readOnly).toBeUndefined();
    });

    it("intermediate folders created by read-only paths are not marked readOnly", () => {
      const tree = buildTreeData([], ["/lib/deep/file.d.ts"]);
      expect(tree.getItem("/lib").readOnly).toBeUndefined();
      expect(tree.getItem("/lib/deep").readOnly).toBeUndefined();
      expect(tree.getItem("/lib/deep/file.d.ts").readOnly).toBe(true);
    });

    it("sorts correctly when readOnly and regular files are mixed", () => {
      const tree = buildTreeData(
        ["/src/main.ts", "/src/utils.ts"],
        ["/src/ambient.d.ts"],
      );
      // Folders first, then files alphabetically
      expect(tree.getChildren("/src")).toEqual([
        "/src/ambient.d.ts",
        "/src/main.ts",
        "/src/utils.ts",
      ]);
    });

    it("read-only paths create proper folder hierarchy", () => {
      const tree = buildTreeData([], ["/node_modules/@types/index.d.ts"]);
      expect(tree.getChildren("/")).toEqual(["/node_modules"]);
      expect(tree.getChildren("/node_modules")).toEqual([
        "/node_modules/@types",
      ]);
      expect(tree.getChildren("/node_modules/@types")).toEqual([
        "/node_modules/@types/index.d.ts",
      ]);
      expect(tree.getItem("/node_modules/@types/index.d.ts").readOnly).toBe(
        true,
      );
    });

    it("works with empty readOnlyPaths (backward compat)", () => {
      const tree = buildTreeData(["/a.ts"]);
      expect(tree.getChildren("/")).toEqual(["/a.ts"]);
      expect(tree.getItem("/a.ts").readOnly).toBeUndefined();
    });
  });

  describe("emptyDirs", () => {
    it("creates folder nodes for empty directories", () => {
      const tree = buildTreeData(["/a.ts"], [], ["/empty"]);
      expect(tree.getChildren("/")).toEqual(
        expect.arrayContaining(["/empty", "/a.ts"]),
      );
      expect(tree.getItem("/empty")).toEqual({
        name: "empty",
        path: "/empty",
        isFolder: true,
      });
      expect(tree.getChildren("/empty")).toEqual([]);
    });

    it("creates nested empty directory hierarchies", () => {
      const tree = buildTreeData([], [], ["/a/b/c"]);
      expect(tree.getChildren("/")).toEqual(["/a"]);
      expect(tree.getChildren("/a")).toEqual(["/a/b"]);
      expect(tree.getChildren("/a/b")).toEqual(["/a/b/c"]);
      expect(tree.getChildren("/a/b/c")).toEqual([]);
      expect(tree.getItem("/a/b/c").isFolder).toBe(true);
    });

    it("does not duplicate nodes that already exist from file paths", () => {
      const tree = buildTreeData(["/src/main.ts"], [], ["/src"]);
      // /src should appear once, with its existing child
      expect(tree.getChildren("/")).toEqual(["/src"]);
      expect(tree.getChildren("/src")).toEqual(["/src/main.ts"]);
    });

    it("skips empty-segment dir paths gracefully", () => {
      const tree = buildTreeData(["/a.ts"], [], [""]);
      expect(tree.getChildren("/")).toEqual(["/a.ts"]);
    });
  });
});
