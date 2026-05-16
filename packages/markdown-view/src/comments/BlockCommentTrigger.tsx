/**
 * Hover affordance and popover form for adding a *block-level* CriticMarkup
 * comment to a rendered block such as a fenced code block or Mermaid diagram.
 *
 * The trigger is rendered as a sibling of the target block inside a
 * position:relative wrapper. CSS hides it by default and reveals it when the
 * wrapper is hovered, so visual baselines on read-only documents remain
 * unchanged. Submitting the form calls `insertBlockComment(view, line,
 * "next", body, author)` so the marker lands on the line *before* the block.
 *
 * At most one block-comment thread is permitted per block. When the trigger
 * detects an existing block thread anchored to its sibling `<pre>`, it
 * switches to a "reuse" mode: clicking the button calls `onActivate(id)` to
 * expand the existing margin bubble instead of opening the new-comment form.
 */

import { useEffect, useState, type FormEvent, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { insertBlockComment } from "./commands";

/** @public */
export type BlockCommentTriggerProps = {
  readonly editorView: EditorView;
  /**
   * Absolute character offset of the start of the target block in the markdown
   * source, taken from the block's `data-source-start` attribute. The trigger
   * converts this to a 1-based line number via `view.state.doc.lineAt`.
   */
  readonly sourceStart: number;
  readonly currentAuthor: string;
  /**
   * Ref to the wrapper element that contains both this trigger and its
   * sibling `<pre>`. Used to look up the adjacent block element so the trigger
   * can decide whether an existing block thread already targets it.
   */
  readonly wrapperRef?: RefObject<HTMLElement | null>;
  /**
   * Called when the user clicks the trigger and an existing thread already
   * targets this block. Should mirror the bubble-click activation in
   * `CommentMargin` so the same thread expands.
   */
  readonly onActivate?: (threadId: string) => void;
};

/**
 * Look for a block-comment marker DOM node adjacent to the wrapper. Block
 * markers are rendered by `BlockCommentMarker` as `<div class='vd-block-comment'
 * data-thread-id=... data-target='next'|'prev'>`. The marker for `target:next`
 * is the wrapper's previous sibling (it sits *before* the block in source
 * order); `target:prev` is the next sibling. Returns the thread id when an
 * adjacent block marker is found.
 */
const findAdjacentBlockThreadId = (
  wrapper: HTMLElement | null,
): string | undefined => {
  if (wrapper === null) return undefined;
  const prev = wrapper.previousElementSibling;
  if (
    prev instanceof HTMLElement &&
    prev.classList.contains("vd-block-comment") &&
    prev.dataset.target === "next"
  ) {
    const id = prev.dataset.threadId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  const next = wrapper.nextElementSibling;
  if (
    next instanceof HTMLElement &&
    next.classList.contains("vd-block-comment") &&
    next.dataset.target === "prev"
  ) {
    const id = next.dataset.threadId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
};

export function BlockCommentTrigger({
  editorView,
  sourceStart,
  currentAuthor,
  wrapperRef,
  onActivate,
}: BlockCommentTriggerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [existingThreadId, setExistingThreadId] = useState<string | undefined>(
    undefined,
  );

  // Watch the wrapper's parent for block-marker siblings appearing or
  // disappearing. We can't depend on `useThreads`'s `markers` array because
  // its identity changes on every DOM mutation (the rehype-rendered tree is
  // rebuilt), and feeding that into the components memo causes the markdown
  // tree to re-render, mutating the DOM, retriggering the scan — infinite
  // loop. Watching the parent directly stays scoped to relevant changes.
  useEffect(() => {
    const wrapper = wrapperRef?.current ?? null;
    if (wrapper === null) return;
    const update = (): void => {
      setExistingThreadId(findAdjacentBlockThreadId(wrapper));
    };
    update();
    const parent = wrapper.parentElement;
    if (parent === null) return;
    const observer = new MutationObserver(update);
    observer.observe(parent, {
      childList: true,
      subtree: false,
      attributes: true,
      attributeFilter: ["data-thread-id", "data-target"],
    });
    return () => {
      observer.disconnect();
    };
  }, [wrapperRef]);

  const close = (): void => {
    setOpen(false);
    setDraft("");
  };

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    // Map the source offset to a line number. lineAt clamps to the document
    // end, so an offset past EOF still produces a valid line.
    const line = editorView.state.doc.lineAt(sourceStart).number;
    insertBlockComment(editorView, line, "next", trimmed, currentAuthor);
    close();
  };

  const hasExisting =
    existingThreadId !== undefined && onActivate !== undefined;

  if (hasExisting) {
    return (
      <button
        type="button"
        className="vd-block-trigger"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          onActivate(existingThreadId);
        }}
        aria-label="Open comment"
        title="Open the existing comment thread for this block"
      >
        Open comment
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="vd-block-trigger"
        // Block selectionchange-driven flicker: clicking the trigger should
        // not move the caret into the underlying <pre> first.
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          setOpen(true);
        }}
        aria-label="Add comment"
        title="Add a new comment on this block"
      >
        Comment
      </button>
    );
  }

  return (
    <form className="vd-block-trigger-popover" onSubmit={handleSubmit}>
      <textarea
        className="vd-block-trigger-input"
        autoFocus
        rows={3}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        placeholder="Add a comment..."
      />
      <div className="vd-block-trigger-actions">
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          title="Post this comment"
        >
          Submit
        </button>
        <button
          type="button"
          onClick={close}
          title="Discard the draft and close this comment box"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
