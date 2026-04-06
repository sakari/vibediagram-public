/**
 * Integration test verifying that authorized accounts (e.g. fuse-mirror worker)
 * can be granted access to projects through the JazzProjectStore.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";
import {
  setupJazzTestSync,
  createJazzTestAccount,
  setActiveAccount,
} from "jazz-tools/testing";
import { co } from "jazz-tools";
import {
  DiagramProject,
  VibeDiagramAccount,
  AuthorizedAccount,
  AuthorizedAccountList,
} from "@diagram/jazz-schema";
import { JazzProjectStore } from "./JazzProjectStore";

describe("JazzProjectStore authorized accounts", () => {
  it("addAccountToAllProjects grants a second account access to existing projects", async () => {
    await setupJazzTestSync();

    // account1 = browser user, account2 = fuse-mirror worker
    const account1 = await createJazzTestAccount({
      AccountSchema: VibeDiagramAccount,
      isCurrentActiveAccount: true,
    });
    const account2 = await createJazzTestAccount();

    setActiveAccount(account1);

    const store = new JazzProjectStore(
      account1 as co.loaded<typeof VibeDiagramAccount>,
    );

    // Create a project as account1
    const projectId = store.createProject("Test Project", [
      { path: "/main.ts", content: "hello" },
    ]);
    expect(projectId).toBeTruthy();

    // Grant account2 writer access to all projects
    await store.addAccountToAllProjects(account2.$jazz.id, "writer");

    // Verify account2 can load the project
    const loaded = await new Promise<co.loaded<typeof DiagramProject> | null>(
      (resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, 10_000);
        DiagramProject.subscribe(
          projectId!,
          {
            resolve: { files: { $each: { content: true } } },
            loadAs: account2,
          },
          (value) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- files may still be loading
            if (value.files && value.files.length > 0) {
              clearTimeout(timeout);
              resolve(value as co.loaded<typeof DiagramProject>);
            }
          },
        );
      },
    );

    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe("Test Project");
    expect(loaded?.files?.[0]?.content?.toString()).toBe("hello");
  }, 15_000);

  it("addAuthorizedMembers auto-adds accounts when creating new projects", async () => {
    await setupJazzTestSync();

    const account1 = await createJazzTestAccount({
      AccountSchema: VibeDiagramAccount,
      isCurrentActiveAccount: true,
    });
    const account2 = await createJazzTestAccount();

    setActiveAccount(account1);

    // Set up authorized accounts list on account1 BEFORE creating projects
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- personal account-level data
    const authorizedList = AuthorizedAccountList.create([], {
      owner: account1,
    });
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- personal account-level data
    const entry = AuthorizedAccount.create(
      { accountId: account2.$jazz.id, role: "writer" },
      { owner: account1 },
    );
    authorizedList.$jazz.push(entry);
    account1.root.$jazz.set("authorizedAccounts", authorizedList);

    const store = new JazzProjectStore(
      account1 as co.loaded<typeof VibeDiagramAccount>,
    );

    // Create a project — should auto-add account2 via addAuthorizedMembers
    const projectId = store.createProject("Auto-Shared Project", [
      { path: "/main.ts", content: "auto-shared" },
    ]);
    expect(projectId).toBeTruthy();

    // Give the async addMember time to complete (it's fire-and-forget)
    await vi.waitFor(
      async () => {
        const loaded = await DiagramProject.load(projectId!, {
          resolve: { files: { $each: { content: true } } },
          loadAs: account2,
        });
        expect(loaded).not.toBeNull();
        expect(loaded!.title).toBe("Auto-Shared Project");
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it("removeAccountFromAllProjects revokes access", async () => {
    await setupJazzTestSync();

    const account1 = await createJazzTestAccount({
      AccountSchema: VibeDiagramAccount,
      isCurrentActiveAccount: true,
    });
    const account2 = await createJazzTestAccount();

    setActiveAccount(account1);

    const store = new JazzProjectStore(
      account1 as co.loaded<typeof VibeDiagramAccount>,
    );

    // Create and share
    const projectId = store.createProject("Shared Then Revoked", [
      { path: "/main.ts", content: "test" },
    ]);
    await store.addAccountToAllProjects(account2.$jazz.id, "writer");

    // Verify access works
    const loaded = await DiagramProject.load(projectId!, {
      resolve: { files: { $each: true } },
      loadAs: account2,
    });
    expect(loaded).not.toBeNull();

    // Revoke access
    await store.removeAccountFromAllProjects(account2.$jazz.id);

    // After removal, account2 should no longer be able to load the project
    // (Jazz marks the member as "revoked" internally but getRoleOf may
    // return undefined for non-members depending on the implementation)
    const projects = account1.root.projects;
    const project = projects[0];
    expect(project).toBeTruthy();
    const group = project.$jazz.owner;
    const members = group.members;
    const account2Member = members.find((m) => m.id === account2.$jazz.id);
    // After removeMember, the account should be absent from the members list
    expect(account2Member).toBeUndefined();
  }, 15_000);
});
