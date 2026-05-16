/**
 * Margin-positioned thread bubble. Collapsed shows a dot icon; expanded shows
 * messages, optional reply input, optional resolve toggle, and the thread id.
 *
 * Reply and resolve UI are hidden when no `editorView` is supplied (read-only
 * mode), since both flows must dispatch a CodeMirror transaction back into the
 * source.
 */

import { useState, type FormEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { appendThreadReply, toggleThreadResolved } from "./commands";
import type { ThreadMarker } from "./types";

/** @public */
export type ThreadBubbleProps = {
  readonly marker: ThreadMarker;
  readonly editorView?: EditorView;
  readonly currentAuthor: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly top: number;
};

export function ThreadBubble({
  marker,
  editorView,
  currentAuthor,
  expanded,
  onToggle,
  top,
}: ThreadBubbleProps) {
  const [draft, setDraft] = useState("");
  const thread = marker.thread;
  const className = `vd-comment-bubble${
    thread.resolved ? " vd-comment-bubble--resolved" : ""
  }`;

  // Reply/resolve are only rendered when `editorView` is set, so these
  // handlers can assume it's defined.
  const handleReply = (e: FormEvent): void => {
    e.preventDefault();
    if (editorView === undefined || draft.trim().length === 0) return;
    appendThreadReply(editorView, marker.id, draft.trim(), currentAuthor);
    setDraft("");
  };

  const handleResolve = (): void => {
    if (editorView === undefined) return;
    toggleThreadResolved(editorView, marker.id);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className={`${className} vd-comment-bubble--collapsed`}
        style={{ top }}
        onClick={onToggle}
        aria-label={`Open thread ${marker.id}`}
        title="Expand this comment thread"
        data-thread-bubble-id={marker.id}
      >
        <span className="vd-comment-bubble-dot" aria-hidden="true" />
        <span className="vd-comment-bubble-count">
          {thread.messages.length}
        </span>
      </button>
    );
  }

  return (
    <div
      className={`${className} vd-comment-bubble--expanded`}
      style={{ top }}
      data-thread-bubble-id={marker.id}
    >
      <div className="vd-comment-bubble-header">
        <span className="vd-comment-bubble-id">#{marker.id}</span>
        <button
          type="button"
          className="vd-comment-bubble-close"
          aria-label="Collapse thread"
          title="Collapse this comment thread"
          onClick={onToggle}
        >
          x
        </button>
      </div>
      <ul className="vd-comment-bubble-messages">
        {thread.messages.map((m, i) => (
          <li key={i} className="vd-comment-message">
            <span className="vd-comment-message-author">@{m.author}</span>
            <span className="vd-comment-message-ts">{m.ts}</span>
            <p className="vd-comment-message-text">{m.text}</p>
          </li>
        ))}
      </ul>
      {editorView !== undefined && (
        <form className="vd-comment-bubble-reply" onSubmit={handleReply}>
          <textarea
            className="vd-comment-bubble-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            placeholder="Reply..."
            rows={2}
          />
          <div className="vd-comment-bubble-actions">
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              title="Post this reply to the thread"
            >
              Reply
            </button>
            <button
              type="button"
              onClick={handleResolve}
              title={
                thread.resolved
                  ? "Reopen this resolved thread"
                  : "Mark this thread as resolved"
              }
            >
              {thread.resolved ? "Reopen" : "Resolve"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
