/**
 * Integration tests verifying that the FUSE mount works with real Jazz sync
 * between two accounts. When a second account modifies a DiagramProject,
 * the FUSE mount (using account1) should reflect the changes, and when FUSE
 * writes files, the second account should see them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupJazzTestSync, createJazzTestAccount } from "jazz-tools/testing";
import { co, Group, type Account } from "jazz-tools";
import Fuse from "fuse-native";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DiagramProject, FileEntry } from "@diagram/jazz-schema";
import { FuseHandlers } from "./fuse-handlers.js";

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

describe("FUSE + Jazz sync integration", () => {
  let _account1: Account;
  let account2: Account;
  let group: Group;
  let project: co.loaded<typeof DiagramProject>;
  let mountPath: string;
  let fuse: Fuse;

  beforeEach(async () => {
    // Sync server must be set up before creating accounts
    await setupJazzTestSync();

    _account1 = await createJazzTestAccount({
      isCurrentActiveAccount: true,
    });
    account2 = await createJazzTestAccount();

    // Create a project on account1 with initial files
    group = Group.create();
    group.makePublic("writer");

    const entries = [
      FileEntry.create(
        {
          path: "/main.ts",
          content: co.plainText().create('console.log("hello");', {
            owner: group,
          }),
        },
        { owner: group },
      ),
      FileEntry.create(
        {
          path: "/utils.ts",
          content: co.plainText().create("export const x = 1;", {
            owner: group,
          }),
        },
        { owner: group },
      ),
    ];
    const fileList = co.list(FileEntry).create(entries, { owner: group });
    project = DiagramProject.create(
      {
        title: "FUSE Sync Test",
        files: fileList,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: group },
    );

    // Mount FUSE backed by account1's project
    mountPath = fs.mkdtempSync(path.join(os.tmpdir(), "fuse-sync-test-"));
    const handlers = new FuseHandlers(project, group);
    fuse = await mountFuse(mountPath, handlers.getOperations());
  });

  afterEach(async () => {
    await unmountFuse(fuse);
    fs.rmSync(mountPath, { recursive: true, force: true });
  });

  it("FUSE mount reads files synced from Jazz Cloud", async () => {
    // Verify directory listing through the filesystem
    const files = await fsp.readdir(mountPath);
    expect(files.sort()).toEqual(["main.ts", "utils.ts"]);

    // Verify file content is readable
    const mainContent = await fsp.readFile(
      path.join(mountPath, "main.ts"),
      "utf8",
    );
    expect(mainContent).toBe('console.log("hello");');

    const utilsContent = await fsp.readFile(
      path.join(mountPath, "utils.ts"),
      "utf8",
    );
    expect(utilsContent).toBe("export const x = 1;");
  }, 15_000);

  it("writes through FUSE propagate to second Jazz account", async () => {
    // Write a new file through the FUSE mount
    await fsp.writeFile(
      path.join(mountPath, "new-file.ts"),
      "export const y = 42;",
    );

    // Account2 subscribes and should eventually see the new file
    await vi.waitFor(
      () => {
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout waiting for sync"));
          }, 5_000);
          const unsub = DiagramProject.subscribe(
            project.$jazz.id,
            {
              resolve: { files: { $each: { content: true } } },
              loadAs: account2,
            },
            (value) => {
              const { files } = value;
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- files may not be loaded yet
              if (!files) return;

              const newFile = Array.from({ length: files.length })
                .map((_, i) => files[i])
                .find((f) => f.path === "/new-file.ts");

              if (newFile?.content) {
                const text = newFile.content.toString();
                if (text === "export const y = 42;") {
                  clearTimeout(timeout);
                  unsub();
                  resolve();
                }
              }
            },
          );
        });
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it("changes from second account appear in FUSE mount", async () => {
    // Account2 subscribes to the project and modifies a file
    const project2 = await new Promise<co.loaded<typeof DiagramProject>>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for project sync"));
        }, 10_000);
        const unsub = DiagramProject.subscribe(
          project.$jazz.id,
          {
            resolve: { files: { $each: { content: true } } },
            loadAs: account2,
          },
          (value) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- files may not be loaded yet
            if (value.files && value.files.length > 0 && value.files[0]) {
              clearTimeout(timeout);
              unsub();
              resolve(value as co.loaded<typeof DiagramProject>);
            }
          },
        );
      },
    );

    // Account2 modifies the content of main.ts
    const mainEntry = Array.from({ length: project2.files!.length })
      .map((_, i) => project2.files![i])
      .find((f) => f?.path === "/main.ts");

    expect(mainEntry?.content).toBeDefined();
    mainEntry!.content!.$jazz.applyDiff('console.log("updated by account2");');

    // FuseHandlers reads directly from the project object, so changes
    // synced to account1's project should be visible through FUSE reads.
    await vi.waitFor(
      async () => {
        const content = await fsp.readFile(
          path.join(mountPath, "main.ts"),
          "utf8",
        );
        expect(content).toBe('console.log("updated by account2");');
      },
      { timeout: 10_000 },
    );
  }, 15_000);
});
