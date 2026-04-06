/**
 * Jazz CRDT schema for diagram projects. Defines the collaborative data model
 * for VibeDiagram: projects, file entries, project lists, and user accounts.
 */
import { co, z } from "jazz-tools";

/** A single file within a diagram project, storing path and collaborative text content. */
export const FileEntry = co.map({
  path: z.string(),
  content: co.plainText(),
});
export type FileEntry = co.loaded<typeof FileEntry>;

/**
 * A diagram project containing metadata and a list of files.
 * Projects can optionally track which project they were forked from via a string ID.
 */
export const DiagramProject = co.map({
  title: z.string(),
  description: z.optional(z.string()),
  files: co.list(FileEntry),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Stores the ID of the original project this was forked from, if any.
  forkedFrom: z.optional(z.string()),
  // Vercel deployment ID for the pinned preview version of this project.
  pinnedDeploymentId: z.optional(z.string()),
  // Immutable Vercel deployment URL for the pinned preview version.
  pinnedDeploymentUrl: z.optional(z.string()),
});
export type DiagramProject = co.loaded<typeof DiagramProject>;

/** An ordered list of diagram projects owned by a user. */
export const ProjectList = co.list(DiagramProject);
export type ProjectList = co.loaded<typeof ProjectList>;

/** An account granted app-wide access to all projects (e.g. fuse-mirror worker). */
export const AuthorizedAccount = co.map({
  accountId: z.string(),
  role: z.union([z.literal("reader"), z.literal("writer"), z.literal("admin")]),
});
export type AuthorizedAccount = co.loaded<typeof AuthorizedAccount>;

/** List of authorized accounts stored in the user's account root. */
export const AuthorizedAccountList = co.list(AuthorizedAccount);
export type AuthorizedAccountList = co.loaded<typeof AuthorizedAccountList>;

/** The root data structure for a user account, containing their project list. */
export const AccountRoot = co.map({
  projects: ProjectList,
  authorizedAccounts: co.optional(AuthorizedAccountList),
});
export type AccountRoot = co.loaded<typeof AccountRoot>;

/** The Jazz account schema for VibeDiagram users, with profile and root data. */
export const VibeDiagramAccount = co
  .account({
    profile: co.profile({ name: z.string() }),
    root: AccountRoot,
  })
  .withMigration((account) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- root may be undefined at runtime for accounts created before this field existed
    if (account.root === undefined) {
      account.$jazz.set("root", { projects: [] });
    }
  });
export type VibeDiagramAccount = co.loaded<typeof VibeDiagramAccount>;
