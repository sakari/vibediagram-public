import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createJazzTestAccount } from "jazz-tools/testing";
import { co, Group } from "jazz-tools";
import Fuse from "fuse-native";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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
      title: "Integration Test Project",
      files: fileList,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { owner: group },
  );
}

function mountFuse(
  mountPath: string,
  ops: ReturnType<FuseHandlers["getOperations"]>,
) {
  return new Promise<Fuse>((resolve, reject) => {
    const fuse = new Fuse(mountPath, ops, { force: true });
    fuse.mount((err: Error | null) => {
      if (err) reject(err);
      else resolve(fuse);
    });
  });
}

function unmountFuse(fuse: Fuse) {
  return new Promise<void>((resolve, reject) => {
    fuse.unmount((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("FUSE integration", () => {
  let group: Group;
  let project: co.loaded<typeof DiagramProject>;
  let mountPath: string;
  let fuse: Fuse;

  beforeEach(async () => {
    await createJazzTestAccount({ isCurrentActiveAccount: true });
    group = Group.create();
    group.makePublic("writer");

    project = createProject(group, [
      { path: "/main.ts", content: 'console.log("hello from jazz");' },
      { path: "/utils.ts", content: "export const x = 42;" },
    ]);

    mountPath = fs.mkdtempSync(path.join(os.tmpdir(), "fuse-mirror-test-"));
    const handlers = new FuseHandlers(project, group);
    fuse = await mountFuse(mountPath, handlers.getOperations());
  });

  afterEach(async () => {
    await unmountFuse(fuse);
    fs.rmSync(mountPath, { recursive: true, force: true });
  });

  it("lists files via readdir", async () => {
    const files = await fsp.readdir(mountPath);
    expect(files.sort()).toEqual(["main.ts", "utils.ts"]);
  });

  it("reads file content", async () => {
    const content = await fsp.readFile(path.join(mountPath, "main.ts"), "utf8");
    expect(content).toBe('console.log("hello from jazz");');
  });

  it("reports correct file size via stat", async () => {
    const stat = await fsp.stat(path.join(mountPath, "main.ts"));
    expect(stat.size).toBe(
      Buffer.byteLength('console.log("hello from jazz");', "utf8"),
    );
  });

  it("writes a file and syncs to Jazz", async () => {
    await fsp.writeFile(path.join(mountPath, "main.ts"), "const y = 2;");
    const readBack = await fsp.readFile(
      path.join(mountPath, "main.ts"),
      "utf8",
    );
    expect(readBack).toBe("const y = 2;");

    // Verify it landed in Jazz CRDT
    const entry = project.files![0]!;
    expect(entry.content?.toString()).toBe("const y = 2;");
  });

  it("creates a new file", async () => {
    await fsp.writeFile(path.join(mountPath, "new.ts"), "brand new file");
    const readBack = await fsp.readFile(path.join(mountPath, "new.ts"), "utf8");
    expect(readBack).toBe("brand new file");

    const files = await fsp.readdir(mountPath);
    expect(files).toContain("new.ts");
  });

  it("deletes a file", async () => {
    await fsp.unlink(path.join(mountPath, "utils.ts"));
    const files = await fsp.readdir(mountPath);
    expect(files).not.toContain("utils.ts");
  });

  it("renames a file", async () => {
    await fsp.rename(
      path.join(mountPath, "utils.ts"),
      path.join(mountPath, "helpers.ts"),
    );
    const files = await fsp.readdir(mountPath);
    expect(files).toContain("helpers.ts");
    expect(files).not.toContain("utils.ts");

    const content = await fsp.readFile(
      path.join(mountPath, "helpers.ts"),
      "utf8",
    );
    expect(content).toBe("export const x = 42;");
  });
});
