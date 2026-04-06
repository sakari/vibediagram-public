/**
 * Abstraction layer for project CRUD, forking, access control, and example
 * discovery. The interface boundary exists so the Jazz implementation can be
 * swapped for a different backend in the future.
 */

/** User's permission level on a project. */
export type Role = "reader" | "writer" | "admin";

/** Lightweight summary shown in the project list. */
export interface ProjectSummary {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  role: Role;
  isExample: boolean;
}

export type Unsubscribe = () => void;

export interface ProjectStore {
  /** Return summaries for all projects in the current user's list. */
  listProjects(): ProjectSummary[];

  /** Create a new project owned by the current user. */
  createProject(
    title: string,
    files?: { path: string; content: string }[],
  ): string | null;

  /** Remove a project from the current user's list (admin only). */
  deleteProject(id: string): void;

  /**
   * Deep-copy a project into a new project owned by the current user.
   * Pass `loadedDocument` when forking a project opened via URL that may
   * not be in the user's project list.
   */
  forkProject(id: string, loadedDocument?: unknown): string | null;

  /** Return the current user's role on a project, or undefined if unknown. */
  getRole(id: string): Role | undefined;

  /** Return example project metadata. */
  getExampleProjects(): ProjectSummary[];

  /** Subscribe to changes in the user's project list. */
  onProjectListChange(cb: () => void): Unsubscribe;
}
