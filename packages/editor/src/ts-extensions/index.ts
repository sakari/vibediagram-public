import type { Extension } from "@codemirror/state";
import type { WorkerClient, Reference } from "@diagram/ts-worker";
import { tsLintExtension } from "./lint.js";
import { tsAutocompleteExtension } from "./autocomplete.js";
import { tsHoverExtension } from "./hover.js";
import { tsGoToDefExtension } from "./go-to-def.js";
import { tsReferencesExtension } from "./references.js";
import { tsSyncExtension } from "./sync.js";

export { tsLintExtension } from "./lint.js";
export { tsAutocompleteExtension } from "./autocomplete.js";
export { tsHoverExtension } from "./hover.js";
export { tsGoToDefExtension } from "./go-to-def.js";
export { tsReferencesExtension } from "./references.js";
export { tsSyncExtension, isRemote } from "./sync.js";

/**
 * Creates all TypeScript extensions for a file.
 */
export function tsExtensions(
  client: WorkerClient,
  path: string,
  onNavigate: (targetPath: string, targetOffset: number) => void,
  onReferences?: (references: Reference[]) => void,
): Extension[] {
  const syncState = { dirty: false };
  return [
    tsLintExtension(client, path),
    tsAutocompleteExtension(client, path, syncState),
    tsHoverExtension(client, path),
    tsGoToDefExtension(client, path, onNavigate),
    tsReferencesExtension(client, path, onReferences),
    tsSyncExtension(client, path, syncState),
  ];
}
