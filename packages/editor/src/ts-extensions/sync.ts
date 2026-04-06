import { EditorView } from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { WorkerClient } from "@diagram/ts-worker";

/**
 * Annotation to mark transactions that originate from remote sync (e.g. another
 * editor or external update). Such changes should not be re-synced to the worker.
 */
export const isRemote = Annotation.define<boolean>();

/**
 * Tracks whether the worker has the latest document content.
 * Set to true on every local edit, cleared when the debounced sync fires.
 * The autocomplete source checks this to decide if an eager sync is needed.
 */
export interface WorkerSyncState {
  dirty: boolean;
}

/**
 * Creates the file sync extension. Debounces editor changes by 100ms and syncs
 * content to the worker. Skips syncing when the transaction has isRemote set.
 * Updates the shared syncState so other extensions can check freshness.
 */
export function tsSyncExtension(
  client: WorkerClient,
  path: string,
  syncState: WorkerSyncState,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private timeoutId: ReturnType<typeof setTimeout> | null = null;

      constructor(public view: EditorView) {}

      update(update: import("@codemirror/view").ViewUpdate) {
        if (update.docChanged) {
          const hasRemote = update.transactions.some(
            (tr) => tr.annotation(isRemote) === true,
          );
          if (hasRemote) {
            return;
          }

          syncState.dirty = true;

          if (this.timeoutId != null) {
            clearTimeout(this.timeoutId);
          }

          this.timeoutId = setTimeout(() => {
            this.timeoutId = null;
            syncState.dirty = false;

            void client.syncFile(path, this.view.state.doc.toString());
          }, 100);
        }
      }

      destroy() {
        if (this.timeoutId != null) {
          clearTimeout(this.timeoutId);
        }
      }
    },
  );
}
