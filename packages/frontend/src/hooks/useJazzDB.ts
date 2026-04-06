import { useAccount, useCoState } from "jazz-tools/react";
import { co, type ID, Group } from "jazz-tools";
import { DiagramProject, FileEntry } from "../jazz/schema";

export { DiagramProject };

/** @public @deprecated Use DiagramProject. Kept for dead code files until PR2. */
export const DiagramDocument = DiagramProject;
/** @public */
export type DiagramDocument = co.loaded<typeof DiagramProject>;

/** Hook for loading and managing a DiagramProject. */
export function useDiagramDocument(
  documentId?: ID<co.loaded<typeof DiagramProject>>,
) {
  const { me } = useAccount();
  const document = useCoState(DiagramProject, documentId);

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
