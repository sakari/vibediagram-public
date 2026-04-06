import { EditorView, Decoration, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { StateField, StateEffect } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import type { WorkerClient, Reference } from "@diagram/ts-worker";

/** Sets reference highlight ranges in the editor. */
const setReferenceHighlights =
  StateEffect.define<{ from: number; to: number }[]>();

/** Clears all reference highlights. */
const clearReferenceHighlights = StateEffect.define();

const refHighlightMark = Decoration.mark({ class: "cm-ts-ref-highlight" });

/**
 * State field that tracks reference highlight decorations.
 * Highlights are cleared automatically on selection change or via Escape.
 */
const referenceHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReferenceHighlights)) {
        return Decoration.set(
          effect.value.map((r) => refHighlightMark.range(r.from, r.to)),
        );
      }
      if (effect.is(clearReferenceHighlights)) {
        return Decoration.none;
      }
    }
    // Clear on any selection change (cursor move or doc change)
    if (tr.selection && decorations !== Decoration.none) {
      return Decoration.none;
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Creates a find-references extension for the editor.
 *
 * Binds Shift+F12 to fetch references from the TypeScript worker,
 * highlights same-file references, and calls the optional onReferences
 * callback with all references. Escape clears the highlights; they also
 * clear automatically on any selection change.
 */
export function tsReferencesExtension(
  client: WorkerClient,
  path: string,
  onReferences?: (references: Reference[]) => void,
): Extension {
  const findRefsAt = (view: EditorView, pos: number) => {
    void client.getReferences(path, pos).then((references) => {
      if (references.length === 0) return;

      const sameFile = references
        .filter((r) => r.path === path)
        .map((r) => ({ from: r.start, to: r.end }));

      if (sameFile.length > 0) {
        view.dispatch({
          effects: setReferenceHighlights.of(sameFile),
        });
      }

      onReferences?.(references);
    });
  };

  const findRefsHandler = (view: EditorView) => {
    findRefsAt(view, view.state.selection.main.head);
    return true;
  };

  return [
    referenceHighlightField,
    EditorView.baseTheme({
      ".cm-ts-ref-highlight": {
        backgroundColor: "rgba(255, 213, 0, 0.3)",
        borderRadius: "2px",
      },
    }),
    EditorView.domEventHandlers({
      click: (event, view) => {
        if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return;
        findRefsAt(view, pos);
      },
    }),
    keymap.of([
      {
        key: "Shift-F12",
        run: findRefsHandler,
      },
      {
        key: "Mod-Shift-F12",
        run: findRefsHandler,
      },
      {
        key: "Escape",
        run: (view) => {
          const highlights = view.state.field(referenceHighlightField);
          if (highlights === Decoration.none) return false;
          view.dispatch({
            effects: clearReferenceHighlights.of(null),
          });
          return true;
        },
      },
    ]),
  ];
}
