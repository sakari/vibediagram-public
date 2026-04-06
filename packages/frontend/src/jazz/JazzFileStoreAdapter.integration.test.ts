/**
 * Integration tests verifying that two JazzFileStoreAdapter instances
 * (simulating two browser tabs) connected to the same Jazz DiagramProject
 * can see each other's changes through Jazz sync.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setupJazzTestSync,
  createJazzTestAccount,
  setActiveAccount,
} from "jazz-tools/testing";
import { co, Group, type Account } from "jazz-tools";
import { DiagramProject, FileEntry } from "@diagram/jazz-schema";
import { JazzFileStoreAdapter } from "./JazzFileStoreAdapter.js";

describe("JazzFileStoreAdapter integration (two-tab sync)", () => {
  let account1: Account;
  let account2: Account;
  let group: Group;
  let project1: co.loaded<typeof DiagramProject>;
  let project2: co.loaded<typeof DiagramProject>;
  let adapter1: JazzFileStoreAdapter;
  let adapter2: JazzFileStoreAdapter;
  const unsubscribes: (() => void)[] = [];

  beforeEach(async () => {
    // Sync server must be set up before creating accounts so they
    // connect to the shared in-memory server automatically.
    await setupJazzTestSync();

    account1 = await createJazzTestAccount({
      isCurrentActiveAccount: true,
    });
    account2 = await createJazzTestAccount();

    // Restore account1 as active since account creation may change it
    setActiveAccount(account1);

    // Create a shared group and add account2 as a writer so both
    // accounts can read and write with proper encryption key sharing.
    group = Group.create();
    group.addMember(account2, "writer");

    const entry = FileEntry.create(
      {
        path: "/main.ts",
        content: co.plainText().create("initial content", { owner: group }),
      },
      { owner: group },
    );
    const fileList = co.list(FileEntry).create([entry], { owner: group });
    project1 = DiagramProject.create(
      {
        title: "Test Project",
        files: fileList,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: group },
    );

    // Subscribe from account2 and wait until the project (with nested
    // files and content) is fully loaded through sync.
    project2 = await new Promise<co.loaded<typeof DiagramProject>>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for project sync"));
        }, 12_000);
        const unsub = DiagramProject.subscribe(
          project1.$jazz.id,
          {
            resolve: { files: { $each: { content: true } } },
            loadAs: account2,
          },
          (value) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- files may not be loaded yet
            if (value.files && value.files.length > 0 && value.files[0]) {
              clearTimeout(timeout);
              // Keep subscription alive for the adapter; clean up in afterEach
              unsubscribes.push(unsub);
              resolve(value as co.loaded<typeof DiagramProject>);
            }
          },
        );
      },
    );

    adapter1 = new JazzFileStoreAdapter(project1, group);
    adapter2 = new JazzFileStoreAdapter(project2, group);
  }, 15_000);

  afterEach(() => {
    for (const unsub of unsubscribes) {
      unsub();
    }
    unsubscribes.length = 0;
  });

  it("changes written in one adapter are visible in the other", async () => {
    const onChange = vi.fn();
    unsubscribes.push(adapter2.onFileChange(onChange));

    // Write updated content through adapter1
    adapter1.writeFile("/main.ts", "updated content");

    // adapter2 should eventually receive the change via Jazz sync
    await vi.waitFor(
      () => {
        expect(onChange).toHaveBeenCalledWith(
          "/main.ts",
          expect.stringContaining("updated content"),
        );
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it("new files created in one adapter appear in the other", async () => {
    const onCreated = vi.fn();
    const onChange = vi.fn();
    unsubscribes.push(adapter2.onFileCreated(onCreated));
    // Need an onChange listener to start the Jazz subscription that
    // detects remote changes (checkForUpdates runs on subscription)
    unsubscribes.push(adapter2.onFileChange(onChange));

    // Create a new file through adapter1
    adapter1.writeFile("/new-file.ts", "brand new file");

    // adapter2 should see the new file appear via its change detection.
    // The internal subscription fires onChange for newly-seen paths.
    await vi.waitFor(
      () => {
        expect(onChange).toHaveBeenCalledWith(
          "/new-file.ts",
          expect.stringContaining("brand new file"),
        );
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it("file deletion in one adapter is reflected in the other", async () => {
    const onDeleted = vi.fn();
    const onChange = vi.fn();
    unsubscribes.push(adapter2.onFileDeleted(onDeleted));
    unsubscribes.push(adapter2.onFileChange(onChange));

    // Delete the initial file through adapter1
    adapter1.deleteFile("/main.ts");

    // adapter2 should eventually no longer list the file
    await vi.waitFor(
      () => {
        const files = adapter2.listFiles();
        expect(files).not.toContain("/main.ts");
      },
      { timeout: 10_000 },
    );
  }, 15_000);
});
