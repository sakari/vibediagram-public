/**
 * Floating "Comment" popover shown over a non-collapsed text selection in the
 * preview pane. Submitting calls `insertInlineComment` which wraps the source
 * range with CriticMarkup.
 */

import { useState, type FormEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { insertInlineComment } from "./commands";
import type { SelectionRange } from "./selection";

/** @public */
export type NewCommentPopoverProps = {
  readonly editorView: EditorView;
  readonly selection: SelectionRange | null;
  readonly currentAuthor: string;
  readonly onClose: () => void;
};

export function NewCommentPopover({
  editorView,
  selection,
  currentAuthor,
  onClose,
}: NewCommentPopoverProps) {
  const [draft, setDraft] = useState("");
  // Snapshot the selection range when the form opens. The browser collapses
  // the text selection as soon as the user clicks/focuses the textarea, so the
  // live `selection` prop becomes null mid-drafting; we hold onto the range
  // captured at trigger-click time and use that for submit.
  const [snapshot, setSnapshot] = useState<SelectionRange | null>(null);
  const open = snapshot !== null;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (draft.trim().length === 0 || snapshot === null) return;
    insertInlineComment(
      editorView,
      { sourceStart: snapshot.sourceStart, sourceEnd: snapshot.sourceEnd },
      draft.trim(),
      currentAuthor,
    );
    setDraft("");
    setSnapshot(null);
    onClose();
  };

  if (!open) {
    if (selection === null) return null;
    const liveSelection = selection;
    return (
      <button
        type="button"
        className="vd-new-comment-trigger"
        // Suppress the default mousedown so the click does not tear down the
        // text selection before our React handler captures it.
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          setSnapshot(liveSelection);
        }}
      >
        Comment
      </button>
    );
  }
  return (
    <form className="vd-new-comment-popover" onSubmit={handleSubmit}>
      <textarea
        className="vd-new-comment-input"
        autoFocus
        rows={3}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        placeholder="Add a comment..."
      />
      <div className="vd-new-comment-actions">
        <button type="submit" disabled={draft.trim().length === 0}>
          Submit
        </button>
        <button
          type="button"
          onClick={() => {
            setSnapshot(null);
            setDraft("");
            onClose();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
