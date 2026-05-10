/**
 * Position-only sentinel rendered for a CriticMarkup block comment. The
 * element contributes zero height to layout but still has a bounding rect so
 * `CommentMargin` can align a bubble to it.
 */

/** @public */
export type BlockCommentMarkerProps = {
  readonly threadId: string;
  readonly target: "next" | "prev";
  readonly resolved: boolean;
  /**
   * Length of the underlying block marker in original source bytes, passed
   * straight through from the rehype-set attribute. Forwarded to the DOM as
   * `data-original-length` so the selection mapper can advance past the
   * rendered marker by source-character count.
   */
  readonly originalLength?: string;
};

export function BlockCommentMarker({
  threadId,
  target,
  resolved,
  originalLength,
}: BlockCommentMarkerProps) {
  return (
    <div
      className="vd-block-comment"
      data-thread-id={threadId}
      data-target={target}
      data-resolved={String(resolved)}
      data-original-length={originalLength}
      aria-hidden="true"
    />
  );
}
