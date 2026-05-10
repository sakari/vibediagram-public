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
 * A single freehand stroke drawn on top of either the diagram or markdown view.
 *
 * `pointsJson` is a JSON-encoded `number[][]` of `[x, y]` pairs in the host
 * view's content coordinate space (flow coordinates for diagram, scrollable
 * content-box coordinates for markdown). A stroke is written once on
 * `pointerup` and never edited; storing all points as a single string keeps
 * the per-stroke CRDT footprint to one op rather than one op per point.
 */
export const Stroke = co.map({
  // Stable globally-unique id minted by the overlay before the stroke is
  // appended. Lets backends and the eraser tool address an individual stroke
  // without depending on its position in the CoList (which can shift as
  // other authors splice). The overlay generates this with crypto.randomUUID().
  id: z.string(),
  view: z.enum(["diagram", "markdown"]),
  // Present only for markdown strokes, where it identifies the markdown file
  // the stroke belongs to. Absent for diagram strokes (one diagram per project).
  filePath: z.optional(z.string()),
  // JSON-encoded number[][] of [x, y] points in the host view's content coords.
  pointsJson: z.string(),
  color: z.string(),
  width: z.number(),
  authorId: z.string(),
  createdAt: z.string(),
});
export type Stroke = co.loaded<typeof Stroke>;

/**
 * Collaborative drawing surface for a single project.
 *
 * `strokes` is the durable list of completed strokes; clearing the surface
 * means splicing it to empty. `cursors` is a per-session append-only feed of
 * pointer ticks: each entry is a JSON string carrying
 * `{view, filePath?, x, y, drawing, name, t}` where `t` is epoch ms. CoFeed
 * has no built-in TTL, so consumers must hide ticks whose `t` is older than
 * a small staleness threshold (~2000 ms) client-side.
 */
export const Annotations = co.map({
  strokes: co.list(Stroke),
  cursors: co.feed(z.string()),
});
export type Annotations = co.loaded<typeof Annotations>;

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
  // Collaborative drawing surface for this project (per-project, lazy-bootstrapped).
  // Optional so existing projects without an annotations CoMap continue to load;
  // it is populated the first time a writer opens the project.
  annotations: co.optional(Annotations),
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
