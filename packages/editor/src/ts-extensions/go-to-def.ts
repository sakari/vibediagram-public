import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { WorkerClient } from "@diagram/ts-worker";

/**
 * Navigates to the definition at the given position. Same-file definitions
 * scroll the editor; cross-file definitions call onNavigate.
 */
function goToDefinitionAt(
  view: EditorView,
  client: WorkerClient,
  path: string,
  pos: number,
  onNavigate: (targetPath: string, targetOffset: number) => void,
): void {
  void client.getDefinition(path, pos).then((result) => {
    if (!result) {
      return;
    }

    if (result.targetPath === path) {
      view.dispatch({
        selection: { anchor: result.targetOffset },
        effects: EditorView.scrollIntoView(result.targetOffset, {
          y: "center",
        }),
      });
    } else {
      onNavigate(result.targetPath, result.targetOffset);
    }
  });
}

/**
 * Creates the go-to-definition extension. Handles Ctrl/Cmd+Click and F12
 * to navigate to the definition. Same-file navigation scrolls the editor;
 * cross-file calls onNavigate callback.
 */
export function tsGoToDefExtension(
  client: WorkerClient,
  path: string,
  onNavigate: (targetPath: string, targetOffset: number) => void,
): Extension {
  return [
    EditorView.domEventHandlers({
      click: (event, view) => {
        if (!(event.metaKey || event.ctrlKey) || event.shiftKey) {
          return;
        }

        const coords = { x: event.clientX, y: event.clientY };
        const pos = view.posAtCoords(coords);
        if (pos == null) {
          return;
        }

        goToDefinitionAt(view, client, path, pos, onNavigate);
      },
    }),
    keymap.of([
      {
        key: "F12",
        run: (view) => {
          const pos = view.state.selection.main.head;
          goToDefinitionAt(view, client, path, pos, onNavigate);
          return true;
        },
      },
      {
        key: "Mod-F12",
        run: (view) => {
          const pos = view.state.selection.main.head;
          goToDefinitionAt(view, client, path, pos, onNavigate);
          return true;
        },
      },
    ]),
  ];
}
