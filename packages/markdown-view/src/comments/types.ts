/**
 * Shared types for the CriticMarkup comment UI layer.
 *
 * `MarkdownPreview` parses CriticMarkup via the remark plugin into DOM elements
 * carrying `data-thread-id`. The comment UI scans the rendered DOM, decodes the
 * thread metadata that lived in the source, and overlays bubbles aligned to
 * those anchors. These types describe the decoded shape passed between
 * `useThreads`, `CommentMargin`, and `ThreadBubble`.
 */

import type { InlineThread, BlockThread } from "../criticmarkup";

/** @public */
export type ThreadKind = "inline" | "block";

/** @public */
export type SourceRange = {
  readonly start: number;
  readonly end: number;
};

/** @public */
export type ThreadMarker =
  | {
      readonly id: string;
      readonly kind: "inline";
      readonly thread: InlineThread;
      readonly anchorEl: HTMLElement;
      readonly sourceRange?: SourceRange;
    }
  | {
      readonly id: string;
      readonly kind: "block";
      readonly thread: BlockThread;
      readonly anchorEl: HTMLElement;
      readonly sourceRange?: SourceRange;
    };
