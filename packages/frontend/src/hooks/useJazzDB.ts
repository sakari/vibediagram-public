import { useAccount, useCoState } from "jazz-tools/react";
import { co, z, type ID, Group } from "jazz-tools";
import { DiagramProject, FileEntry, Stroke, Annotations } from "../jazz/schema";

export { DiagramProject };

/** @public @deprecated Use DiagramProject. Kept for dead code files until PR2. */
export const DiagramDocument = DiagramProject;
/** @public */
export type DiagramDocument = co.loaded<typeof DiagramProject>;

/**
 * The shape of a freshly-bootstrapped `Annotations` CoMap with its
 * `strokes` and `cursors` children deeply loaded. Matches the resolve query
 * that `useDiagramDocument` uses, so values returned by
 * `createAnnotations()` are assignment-compatible with
 * `document.$jazz.set("annotations", …)` on a deeply-loaded project.
 */
type LoadedAnnotations = co.loaded<
  typeof Annotations,
  { strokes: { $each: true }; cursors: true }
>;

/**
 * Create a fresh `Annotations` CoMap with its own public-writer Group.
 *
 * Annotations live in a separate Group from the project so that read-only
 * viewers of the project (members of the project Group with role `reader`)
 * can still append strokes and cursor ticks. The annotations Group is
 * `everyone:"writer"` ("public-write"); discoverability is gated by the
 * unguessable Jazz CoValue ID, which is only reachable via the
 * (access-controlled) project document.
 *
 * Used at project create time and as a defensive lazy-create when a writer
 * opens an older project that predates the annotations field.
 */
export function createAnnotations(): LoadedAnnotations {
  const annotationsGroup = Group.create();
  annotationsGroup.makePublic("writer");

  // Strokes and cursors are non-null by construction here (we just made
  // them), but the unresolved `Annotations` shape types them as nullable.
  // Cast to the deeply-loaded shape so callers can assign directly without
  // runtime-meaningless null checks.
  return Annotations.create(
    {
      strokes: co.list(Stroke).create([], { owner: annotationsGroup }),
      cursors: co.feed(z.string()).create([], { owner: annotationsGroup }),
    },
    { owner: annotationsGroup },
  ) as LoadedAnnotations;
}

/** Hook for loading and managing a DiagramProject. */
export function useDiagramDocument(
  documentId?: ID<co.loaded<typeof DiagramProject>>,
) {
  const { me } = useAccount();
  // Resolve nested annotations + strokes + cursors so that React re-renders
  // when remote writers append strokes or cursor ticks. Without this query,
  // `document.annotations` and its children load lazily and updates do not
  // trigger a render.
  const document = useCoState(DiagramProject, documentId, {
    resolve: {
      annotations: { strokes: { $each: true }, cursors: true },
    },
  });

  const createDocument = (title: string, content: string) => {
    if (!me) return null;
    const group = Group.create();
    group.makePublic("writer");

    const fileEntry = FileEntry.create(
      {
        path: "/main.ts",
        content: co.plainText().create(content, { owner: group }),
      },
      { owner: group },
    );

    const fileList = co.list(FileEntry).create([fileEntry], { owner: group });

    const newDoc = DiagramProject.create(
      {
        title,
        files: fileList,
        annotations: createAnnotations(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: group },
    );

    return newDoc;
  };

  const updateDocument = (
    updates: Partial<{
      content: string;
      title: string;
    }>,
  ) => {
    if (!document) return;

    if (updates.content !== undefined) {
      const files = document.files;
      if (files && files.length > 0) {
        const mainFile = files[0];
        if (mainFile?.content) {
          mainFile.content.$jazz.applyDiff(updates.content);
        }
      }
    }
    if (updates.title !== undefined) {
      document.$jazz.set("title", updates.title);
    }

    document.$jazz.set("updatedAt", new Date().toISOString());
  };

  return {
    document,
    createDocument,
    updateDocument,
    isLoading: !document && !!documentId,
  };
}
