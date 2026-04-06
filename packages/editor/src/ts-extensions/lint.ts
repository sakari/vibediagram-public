import { linter, forceLinting } from "@codemirror/lint";
import { ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { WorkerClient } from "@diagram/ts-worker";
import { mapDiagnostic } from "./mappers.js";

/**
 * Creates the TypeScript linting extension. Uses an async linter source that
 * fetches diagnostics from the worker and maps them to CodeMirror format.
 * Also listens for onDiagnosticsUpdated push messages to force a lint refresh.
 */
export function tsLintExtension(client: WorkerClient, path: string): Extension {
  const lintSource = async () => {
    const diagnostics = await client.getDiagnostics(path);
    return diagnostics.map(mapDiagnostic);
  };

  const diagnosticsListener = ViewPlugin.fromClass(
    class {
      constructor(public view: import("@codemirror/view").EditorView) {
        const prev = client.onDiagnosticsUpdated;
        client.onDiagnosticsUpdated = (updatedPath, _diagnostics) => {
          if (updatedPath === path) {
            forceLinting(this.view);
          }
          prev?.(updatedPath, _diagnostics);
        };
        this._prevHandler = prev;
      }

      private _prevHandler = client.onDiagnosticsUpdated;

      destroy() {
        client.onDiagnosticsUpdated = this._prevHandler;
      }
    },
  );

  return [linter(lintSource), diagnosticsListener];
}
