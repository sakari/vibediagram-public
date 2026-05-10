/**
 * Renders the inline `<mark>` element for a CriticMarkup highlight. Clicking
 * notifies the parent so the matching margin bubble can expand.
 */

import type { ReactNode, MouseEvent } from "react";

/** @public */
export type CommentHighlightProps = {
  readonly threadId: string;
  readonly resolved: boolean;
  readonly children?: ReactNode;
  readonly onActivate: (threadId: string) => void;
  /**
   * Length of the underlying CriticMarkup marker in original source bytes,
   * passed straight through from the rehype-set attribute. Forwarded to the
   * DOM as `data-original-length` so the selection mapper can advance past
   * the rendered marker by source-character count.
   */
  readonly originalLength?: string;
};

export function CommentHighlight({
  threadId,
  resolved,
  children,
  onActivate,
  originalLength,
}: CommentHighlightProps) {
  const handleClick = (e: MouseEvent<HTMLElement>): void => {
    e.preventDefault();
    onActivate(threadId);
  };
  return (
    <mark
      className={`vd-comment-anchor${
        resolved ? " vd-comment-anchor--resolved" : ""
      }`}
      data-thread-id={threadId}
      data-critic="highlight"
      data-resolved={String(resolved)}
      data-original-length={originalLength}
      onClick={handleClick}
    >
      {children}
    </mark>
  );
}
