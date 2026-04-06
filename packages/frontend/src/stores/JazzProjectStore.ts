/**
 * Jazz-backed implementation of ProjectStore. Reads from Account.root.projects,
 * uses Jazz Groups for access control, and serves example metadata from
 * @diagram/sim-examples.
 */
import { co, Group, Account, type ID } from "jazz-tools";
import {
  DiagramProject,
  FileEntry,
  type VibeDiagramAccount,
} from "../jazz/schema";
import { exampleProjects, type ExampleMeta } from "@diagram/sim-examples";
import type {
  ProjectStore,
  ProjectSummary,
  Role,
  Unsubscribe,
} from "./ProjectStore";

const FileList = co.list(FileEntry);

/** Map Jazz group role strings to our Role type. */
export function toRole(jazzRole: string | undefined): Role | undefined {
  if (jazzRole === "admin") return "admin";
  if (jazzRole === "writer") return "writer";
  if (jazzRole === "reader") return "reader";
  return undefined;
}

export class JazzProjectStore implements ProjectStore {
  constructor(private readonly account: co.loaded<typeof VibeDiagramAccount>) {}

  /** Load a Jazz Account by ID string, returning null if not found. */
  private async loadAccount(accountId: string): Promise<Account | null> {
    // Using Account.load directly since we're loading a foreign account, not our own schema
    // eslint-disable-next-line @typescript-eslint/no-deprecated, @typescript-eslint/no-unsafe-type-assertion -- loading foreign accounts by ID
    return Account.load(accountId as unknown as ID<Account>, {
      loadAs: this.account,
    });
  }

  /** Add all authorized accounts from settings to a newly created group. */
  private addAuthorizedMembers(group: Group): void {
    const authorizedAccounts = this.account.root?.authorizedAccounts;
    if (!authorizedAccounts) return;
    for (let i = 0; i < authorizedAccounts.length; i++) {
      const entry = authorizedAccounts[i];
      if (!entry) continue;
      const { accountId, role } = entry;
      if (!accountId) continue;
      void this.loadAccount(accountId).then((account) => {
        if (account) group.addMember(account, role);
      });
    }
  }

  listProjects(): ProjectSummary[] {
    const projects = this.account.root?.projects;
    if (!projects) return [];

    const result: ProjectSummary[] = [];
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      if (!p) continue;
      const group = p.$jazz.owner;
      result.push({
        id: p.$jazz.id,
        title: p.title,
        description: p.description ?? undefined,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        role: toRole(group.myRole()) ?? "reader",
        isExample: false,
      });
    }
    return result;
  }

  createProject(
    title: string,
    files?: { path: string; content: string }[],
  ): string | null {
    const projects = this.account.root?.projects;
    if (!projects) return null;

    const group = Group.create();
    this.addAuthorizedMembers(group);

    const fileEntries = (files ?? [{ path: "/main.ts", content: "" }]).map(
      (f) =>
        FileEntry.create(
          {
            path: f.path,
            content: co.plainText().create(f.content, { owner: group }),
          },
          { owner: group },
        ),
    );

    const fileList = FileList.create(fileEntries, { owner: group });
    const now = new Date().toISOString();
    const project = DiagramProject.create(
      {
        title,
        files: fileList,
        createdAt: now,
        updatedAt: now,
      },
      { owner: group },
    );

    projects.$jazz.push(project);
    return project.$jazz.id;
  }

  deleteProject(id: string): void {
    const projects = this.account.root?.projects;
    if (!projects) return;

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      if (p?.$jazz.id === id) {
        const role = toRole(p.$jazz.owner.myRole());
        if (role !== "admin") return;
        projects.$jazz.splice(i, 1);
        return;
      }
    }
  }

  forkProject(
    id: string,
    loadedDocument?: co.loaded<typeof DiagramProject>,
  ): string | null {
    const projects = this.account.root?.projects;
    if (!projects) return null;

    // Use the provided loaded document, or search the user's project list
    let source: co.loaded<typeof DiagramProject> | undefined = loadedDocument;
    if (!source) {
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        if (p?.$jazz.id === id) {
          source = p;
          break;
        }
      }
    }
    if (!source?.files) return null;

    const filesToCopy: { path: string; content: string }[] = [];
    for (let i = 0; i < source.files.length; i++) {
      const entry = source.files[i];
      if (!entry?.path) continue;
      const content = entry.content?.toString();
      if (content === undefined) {
        throw new Error(
          `Cannot fork: file "${entry.path}" content is not loaded`,
        );
      }
      filesToCopy.push({ path: entry.path, content });
    }

    const group = Group.create();
    this.addAuthorizedMembers(group);

    const fileEntries = filesToCopy.map((f) =>
      FileEntry.create(
        {
          path: f.path,
          content: co.plainText().create(f.content, { owner: group }),
        },
        { owner: group },
      ),
    );
    const fileList = FileList.create(fileEntries, { owner: group });
    const now = new Date().toISOString();
    const newProject = DiagramProject.create(
      {
        title: `${source.title} (fork)`,
        files: fileList,
        createdAt: now,
        updatedAt: now,
        forkedFrom: id,
      },
      { owner: group },
    );

    projects.$jazz.push(newProject);
    return newProject.$jazz.id;
  }

  getRole(id: string): Role | undefined {
    const projects = this.account.root?.projects;
    if (!projects) return undefined;

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      if (p?.$jazz.id === id) {
        return toRole(p.$jazz.owner.myRole());
      }
    }
    return undefined;
  }

  /** Grant an account access to all existing projects. */
  async addAccountToAllProjects(
    accountId: string,
    role: "reader" | "writer" | "admin",
  ): Promise<void> {
    const account = await this.loadAccount(accountId);
    if (!account) return;
    const projects = this.account.root?.projects;
    if (!projects) return;
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      if (!p) continue;
      p.$jazz.owner.addMember(account, role);
    }
  }

  /** Remove an account from all existing projects. */
  async removeAccountFromAllProjects(accountId: string): Promise<void> {
    const account = await this.loadAccount(accountId);
    if (!account) return;
    const projects = this.account.root?.projects;
    if (!projects) return;
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      if (!p) continue;
      p.$jazz.owner.removeMember(account);
    }
  }

  getExampleProjects(): ProjectSummary[] {
    return exampleProjects.map((ex: ExampleMeta) => ({
      id: ex.id,
      title: ex.title,
      description: ex.description,
      createdAt: "",
      updatedAt: "",
      role: "reader" as Role,
      isExample: true,
    }));
  }

  onProjectListChange(cb: () => void): Unsubscribe {
    const projects = this.account.root?.projects;
    if (!projects) return () => {};

    const unsub = projects.$jazz.subscribe({}, () => {
      cb();
    });
    return unsub;
  }
}
