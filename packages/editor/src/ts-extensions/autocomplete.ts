import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { WorkerClient } from "@diagram/ts-worker";
import { mapCompletion } from "./mappers.js";
import type { WorkerSyncState } from "./sync.js";

/**
 * Creates the TypeScript autocomplete extension. Uses an async completion source
 * that fetches completions from the worker at the cursor position.
 */
export function tsAutocompleteExtension(
  client: WorkerClient,
  path: string,
  syncState: WorkerSyncState,
): Extension {
  const source = async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const offset = context.pos;
    const word = context.matchBefore(/\w+/);
    const dotAccess = context.matchBefore(/\.\w*/);

    // Activate on: explicit request (Ctrl+Space), word being typed, or dot-access
    if (!context.explicit && !word && !dotAccess) {
      return null;
    }

    const from = word ? word.from : offset;

    // Sync eagerly only when the debounced sync hasn't flushed yet (dirty).
    // This avoids redundant worker round-trips for every keystroke while still
    // ensuring fresh content for cases like this.| typed right after a class.
    if (syncState.dirty) {
      await client.syncFile(path, context.state.doc.toString());
    }
    const completions = await client.getCompletions(path, offset);

    if (completions.length === 0) {
      return null;
    }

    const options = completions.map((c) => mapCompletion(c, from));
    return { from, options };
  };

  return autocompletion({ override: [source] });
}
