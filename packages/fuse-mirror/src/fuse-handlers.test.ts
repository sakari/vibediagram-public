import { describe, it, expect, beforeEach } from "vitest";
import { createJazzTestAccount } from "jazz-tools/testing";
import { co, Group } from "jazz-tools";
import { DiagramProject, FileEntry } from "@diagram/jazz-schema";
import { FuseHandlers } from "./fuse-handlers.js";

function createProject(
  group: Group,
  files: { path: string; content: string }[],
) {
  const entries = files.map((f) =>
    FileEntry.create(
      {
        path: f.path,
        content: co.plainText().create(f.content, { owner: group }),
      },
      { owner: group },
    ),
  );

  const fileList = co.list(FileEntry).create(entries, { owner: group });

  return DiagramProject.create(
    {
      title: "Test Project",
      files: fileList,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { owner: group },
  );
}

function callGetattr(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
) {
  return new Promise<{ code: number; stat?: object }>((resolve) => {
    ops.getattr(path, (code, stat) => {
      resolve({ code, stat });
    });
  });
}

function callReaddir(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
) {
  return new Promise<{ code: number; names?: string[] }>((resolve) => {
    ops.readdir(path, (code, names) => {
      resolve({ code, names });
    });
  });
}

function callOpen(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
) {
  return new Promise<{ code: number; fd?: number }>((resolve) => {
    ops.open(path, 0, (code, fd) => {
      resolve({ code, fd });
    });
  });
}

function callRead(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
  fd: number,
  length: number,
  position: number,
) {
  return new Promise<{ bytesRead: number; data: string }>((resolve) => {
    const buffer = Buffer.alloc(length);
    ops.read(path, fd, buffer, length, position, (bytesRead) => {
      resolve({
        bytesRead,
        data: buffer.subarray(0, bytesRead).toString("utf8"),
      });
    });
  });
}

function callWrite(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
  fd: number,
  content: string,
  position: number,
) {
  return new Promise<number>((resolve) => {
    const buf = Buffer.from(content, "utf8");
    ops.write(path, fd, buf, buf.length, position, (bytesWritten) => {
      resolve(bytesWritten);
    });
  });
}

function callFlush(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
  fd: number,
) {
  return new Promise<number>((resolve) => {
    ops.flush(path, fd, (code) => {
      resolve(code);
    });
  });
}

function callRelease(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
  fd: number,
) {
  return new Promise<number>((resolve) => {
    ops.release(path, fd, (code) => {
      resolve(code);
    });
  });
}

function callCreate(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
) {
  return new Promise<{ code: number; fd?: number }>((resolve) => {
    ops.create(path, 0o644, (code, fd) => {
      resolve({ code, fd });
    });
  });
}

function callUnlink(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
) {
  return new Promise<number>((resolve) => {
    ops.unlink(path, (code) => {
      resolve(code);
    });
  });
}

function callTruncate(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  path: string,
  size: number,
) {
  return new Promise<number>((resolve) => {
    ops.truncate(path, size, (code) => {
      resolve(code);
    });
  });
}

function callRename(
  ops: ReturnType<FuseHandlers["getOperations"]>,
  src: string,
  dest: string,
) {
  return new Promise<number>((resolve) => {
    ops.rename(src, dest, (code) => {
      resolve(code);
    });
  });
}

describe("FuseHandlers", () => {
  let group: Group;
  let project: co.loaded<typeof DiagramProject>;
  let handlers: FuseHandlers;
  let ops: ReturnType<FuseHandlers["getOperations"]>;

  beforeEach(async () => {
    await createJazzTestAccount({ isCurrentActiveAccount: true });
    group = Group.create();
    group.makePublic("writer");

    project = createProject(group, [
      { path: "/main.ts", content: 'console.log("hello");' },
      { path: "/utils.ts", content: "export const x = 1;" },
    ]);

    handlers = new FuseHandlers(project, group);
    ops = handlers.getOperations();
  });

  describe("getattr", () => {
    it("returns directory stats for root", async () => {
      const { code, stat } = await callGetattr(ops, "/");
      expect(code).toBe(0);
      expect(stat).toMatchObject({ mode: 0o40755, size: 4096 });
    });

    it("returns file stats with correct byte size", async () => {
      const { code, stat } = await callGetattr(ops, "/main.ts");
      expect(code).toBe(0);
      expect(stat).toMatchObject({
        mode: 0o100644,
        size: Buffer.byteLength('console.log("hello");', "utf8"),
      });
    });

    it("returns ENOENT for missing files", async () => {
      const { code } = await callGetattr(ops, "/nonexistent.ts");
      expect(code).toBeLessThan(0);
    });
  });

  describe("readdir", () => {
    it("lists files without leading slash", async () => {
      const { code, names } = await callReaddir(ops, "/");
      expect(code).toBe(0);
      expect(names).toContain("main.ts");
      expect(names).toContain("utils.ts");
      expect(names).toHaveLength(2);
    });

    it("returns ENOENT for non-root paths", async () => {
      const { code } = await callReaddir(ops, "/subdir");
      expect(code).toBeLessThan(0);
    });
  });

  describe("read", () => {
    it("reads full file content", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      const { bytesRead, data } = await callRead(ops, "/main.ts", fd!, 1024, 0);
      expect(bytesRead).toBe(
        Buffer.byteLength('console.log("hello");', "utf8"),
      );
      expect(data).toBe('console.log("hello");');
    });

    it("reads partial content at offset", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      const { data } = await callRead(ops, "/main.ts", fd!, 7, 0);
      expect(data).toBe("console");
    });

    it("returns 0 bytes when reading past end", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      const { bytesRead } = await callRead(ops, "/main.ts", fd!, 1024, 9999);
      expect(bytesRead).toBe(0);
    });
  });

  describe("write and flush", () => {
    it("buffers writes and flushes to Jazz CRDT", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      const newContent = "const y = 2;";
      // Truncate first (like editors do when overwriting with shorter content)
      await callTruncate(ops, "/main.ts", 0);
      await callWrite(ops, "/main.ts", fd!, newContent, 0);

      // Before flush, Jazz content is unchanged
      const entry = project.files![0]!;
      expect(entry.content?.toString()).toBe('console.log("hello");');

      // Flush applies the write to Jazz
      await callFlush(ops, "/main.ts", fd!);

      expect(entry.content?.toString()).toBe(newContent);
    });

    it("flushes on release", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      await callTruncate(ops, "/main.ts", 0);
      await callWrite(ops, "/main.ts", fd!, "released content", 0);
      await callRelease(ops, "/main.ts", fd!);

      const entry = project.files![0]!;
      expect(entry.content?.toString()).toBe("released content");
    });

    it("reads back buffered content before flush", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      await callTruncate(ops, "/main.ts", 0);
      await callWrite(ops, "/main.ts", fd!, "buffered!", 0);

      // Read should return the buffered content, not the Jazz content
      const { data } = await callRead(ops, "/main.ts", fd!, 1024, 0);
      expect(data).toBe("buffered!");
    });

    it("appends at offset without truncating", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      // Write at offset 7, keeping existing prefix
      await callWrite(ops, "/main.ts", fd!, "XXX", 7);
      const { data } = await callRead(ops, "/main.ts", fd!, 1024, 0);
      // "console" (7) + "XXX" overwrites ".lo" at positions 7-9
      expect(data).toBe('consoleXXXg("hello");');
    });
  });

  describe("create", () => {
    it("creates a new file entry in Jazz", async () => {
      const { code, fd } = await callCreate(ops, "/new-file.ts");
      expect(code).toBe(0);
      expect(fd).toBeGreaterThan(0);

      const { names } = await callReaddir(ops, "/");
      expect(names).toContain("new-file.ts");

      // Write content and flush
      await callWrite(ops, "/new-file.ts", fd!, "new content", 0);
      await callFlush(ops, "/new-file.ts", fd!);

      // Verify it's in Jazz
      const files = project.files!;
      const newEntry = Array.from(
        { length: files.length },
        (_, i) => files[i],
      ).find((e) => e?.path === "/new-file.ts");
      expect(newEntry?.content?.toString()).toBe("new content");
    });
  });

  describe("unlink", () => {
    it("removes a file from Jazz", async () => {
      const code = await callUnlink(ops, "/utils.ts");
      expect(code).toBe(0);

      const { names } = await callReaddir(ops, "/");
      expect(names).not.toContain("utils.ts");
      expect(names).toHaveLength(1);
    });

    it("returns ENOENT for missing files", async () => {
      const code = await callUnlink(ops, "/nonexistent.ts");
      expect(code).toBeLessThan(0);
    });
  });

  describe("truncate", () => {
    it("truncates file content and flushes", async () => {
      const code = await callTruncate(ops, "/main.ts", 7);
      expect(code).toBe(0);

      // Open and read to verify truncation
      const { fd } = await callOpen(ops, "/main.ts");
      // Flush the truncation to Jazz
      await callFlush(ops, "/main.ts", fd!);

      const entry = project.files![0]!;
      expect(entry.content?.toString()).toBe("console");
    });
  });

  describe("rename", () => {
    it("updates the file path in Jazz", async () => {
      const code = await callRename(ops, "/utils.ts", "/helpers.ts");
      expect(code).toBe(0);

      const { names } = await callReaddir(ops, "/");
      expect(names).toContain("helpers.ts");
      expect(names).not.toContain("utils.ts");
    });

    it("returns ENOENT for missing source", async () => {
      const code = await callRename(ops, "/nonexistent.ts", "/other.ts");
      expect(code).toBeLessThan(0);
    });

    it("updates open fds to use new path", async () => {
      const { fd } = await callOpen(ops, "/utils.ts");
      await callRename(ops, "/utils.ts", "/helpers.ts");

      // Write via the fd that was opened under the old name
      await callTruncate(ops, "/helpers.ts", 0);
      await callWrite(ops, "/helpers.ts", fd!, "renamed write", 0);
      await callFlush(ops, "/helpers.ts", fd!);

      // Verify the content landed in Jazz under the new path
      const files = project.files!;
      const entry = Array.from(
        { length: files.length },
        (_, i) => files[i],
      ).find((e) => e?.path === "/helpers.ts");
      expect(entry?.content?.toString()).toBe("renamed write");
    });
  });

  describe("flush then write again", () => {
    it("preserves buffer across flush so subsequent writes work", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      await callTruncate(ops, "/main.ts", 0);
      await callWrite(ops, "/main.ts", fd!, "first write", 0);
      await callFlush(ops, "/main.ts", fd!);

      // Write again without re-opening — buffer should still be alive
      await callTruncate(ops, "/main.ts", 0);
      await callWrite(ops, "/main.ts", fd!, "second write", 0);
      await callFlush(ops, "/main.ts", fd!);

      const entry = project.files![0]!;
      expect(entry.content?.toString()).toBe("second write");
    });
  });

  describe("ftruncate", () => {
    it("truncates via file descriptor", async () => {
      const { fd } = await callOpen(ops, "/main.ts");

      const code = await new Promise<number>((resolve) => {
        ops.ftruncate("/main.ts", fd!, 7, (c) => {
          resolve(c);
        });
      });
      expect(code).toBe(0);

      await callFlush(ops, "/main.ts", fd!);
      const entry = project.files![0]!;
      expect(entry.content?.toString()).toBe("console");
    });
  });

  describe("statfs", () => {
    it("returns filesystem stats", async () => {
      const result = await new Promise<{ code: number; stat?: object }>(
        (resolve) => {
          ops.statfs("/", (code, stat) => {
            resolve({ code, stat });
          });
        },
      );
      expect(result.code).toBe(0);
      expect(result.stat).toMatchObject({ bsize: 4096, namemax: 255 });
    });
  });

  describe("open", () => {
    it("returns ENOENT for nonexistent file", async () => {
      const { code } = await callOpen(ops, "/nonexistent.ts");
      expect(code).toBeLessThan(0);
    });
  });

  describe("multi-byte content", () => {
    it("reports correct byte size for non-ASCII content", async () => {
      // Create a file with multi-byte UTF-8 characters
      const { fd } = await callCreate(ops, "/emoji.ts");
      const content = 'const x = "héllo 🌍";';
      await callWrite(ops, "/emoji.ts", fd!, content, 0);
      await callFlush(ops, "/emoji.ts", fd!);

      const { stat } = await callGetattr(ops, "/emoji.ts");
      expect(stat).toMatchObject({
        size: Buffer.byteLength(content, "utf8"),
      });

      // Read it back
      const { data } = await callRead(ops, "/emoji.ts", fd!, 1024, 0);
      expect(data).toBe(content);
    });
  });

  describe("path validation", () => {
    it("rejects create with traversal path", async () => {
      const { code } = await callCreate(ops, "/../../../etc/passwd");
      expect(code).toBeLessThan(0);
    });

    it("rejects create with subdirectory path", async () => {
      const { code } = await callCreate(ops, "/sub/dir/file.ts");
      expect(code).toBeLessThan(0);
    });

    it("rejects create with null byte in path", async () => {
      const { code } = await callCreate(ops, "/file\0.ts");
      expect(code).toBeLessThan(0);
    });

    it("rejects create with newline in path", async () => {
      const { code } = await callCreate(ops, "/file\n.ts");
      expect(code).toBeLessThan(0);
    });

    it("rejects create with very long path", async () => {
      const { code } = await callCreate(ops, "/" + "a".repeat(300));
      expect(code).toBeLessThan(0);
    });

    it("rejects create for existing file", async () => {
      const { code } = await callCreate(ops, "/main.ts");
      expect(code).toBeLessThan(0);
    });

    it("rejects rename to invalid dest", async () => {
      const code = await callRename(ops, "/utils.ts", "/../../../tmp/pwned");
      expect(code).toBeLessThan(0);
    });

    it("rename overwrites existing destination (POSIX semantics)", async () => {
      const code = await callRename(ops, "/utils.ts", "/main.ts");
      expect(code).toBe(0);

      const { names } = await callReaddir(ops, "/");
      expect(names).toContain("main.ts");
      expect(names).not.toContain("utils.ts");
      expect(names).toHaveLength(1);
    });
  });

  describe("bounds safety", () => {
    it("clamps negative read position to 0", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      const { data } = await callRead(ops, "/main.ts", fd!, 7, -5);
      expect(data).toBe("console");
    });

    it("rejects write at offset beyond 10MB", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      const result = await callWrite(
        ops,
        "/main.ts",
        fd!,
        "x",
        11 * 1024 * 1024,
      );
      expect(result).toBeLessThan(0);
    });

    it("returns ENOENT for write to invalid fd", async () => {
      const result = await callWrite(ops, "/main.ts", 9999, "x", 0);
      expect(result).toBeLessThan(0);
    });

    it("returns ENOENT for write to released fd", async () => {
      const { fd } = await callOpen(ops, "/main.ts");
      await callRelease(ops, "/main.ts", fd!);
      const result = await callWrite(ops, "/main.ts", fd!, "x", 0);
      expect(result).toBeLessThan(0);
    });
  });

  describe("static files", () => {
    let staticOps: ReturnType<FuseHandlers["getOperations"]>;

    beforeEach(() => {
      const staticFiles = new Map([
        [
          "/node_modules/@diagram/sim-model/package.json",
          '{"name":"@diagram/sim-model"}',
        ],
        [
          "/node_modules/@diagram/sim-model/index.d.ts",
          "export declare const x: number;",
        ],
        ["/tsconfig.json", '{"compilerOptions":{}}'],
      ]);
      const staticHandlers = new FuseHandlers(project, group, { staticFiles });
      staticOps = staticHandlers.getOperations();
    });

    it("lists static files and dirs in root readdir", async () => {
      const { names } = await callReaddir(staticOps, "/");
      expect(names).toContain("main.ts");
      expect(names).toContain("node_modules");
      expect(names).toContain("tsconfig.json");
    });

    it("traverses static directories", async () => {
      const result = await callReaddir(staticOps, "/node_modules");
      expect(result.code).toBe(0);
      expect(result.names).toContain("@diagram");

      const result2 = await callReaddir(staticOps, "/node_modules/@diagram");
      expect(result2.code).toBe(0);
      expect(result2.names).toContain("sim-model");

      const result3 = await callReaddir(
        staticOps,
        "/node_modules/@diagram/sim-model",
      );
      expect(result3.code).toBe(0);
      expect(result3.names).toContain("package.json");
      expect(result3.names).toContain("index.d.ts");
    });

    it("returns directory stat for static dirs", async () => {
      const { code, stat } = await callGetattr(staticOps, "/node_modules");
      expect(code).toBe(0);
      expect(stat).toMatchObject({ mode: 0o40755 });
    });

    it("reads static file content", async () => {
      const { fd } = await callOpen(
        staticOps,
        "/node_modules/@diagram/sim-model/index.d.ts",
      );
      const { data } = await callRead(
        staticOps,
        "/node_modules/@diagram/sim-model/index.d.ts",
        fd!,
        1024,
        0,
      );
      expect(data).toBe("export declare const x: number;");
    });

    it("rejects write to static file", async () => {
      const { fd } = await callOpen(staticOps, "/tsconfig.json");
      const result = await callWrite(
        staticOps,
        "/tsconfig.json",
        fd!,
        "nope",
        0,
      );
      expect(result).toBeLessThan(0);
    });

    it("rejects unlink on static file", async () => {
      const code = await callUnlink(staticOps, "/tsconfig.json");
      expect(code).toBeLessThan(0);
    });

    it("rejects rename of static file", async () => {
      const code = await callRename(staticOps, "/tsconfig.json", "/ts.json");
      expect(code).toBeLessThan(0);
    });
  });
});
