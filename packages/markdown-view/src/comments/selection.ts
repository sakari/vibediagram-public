/**
 * Map a DOM Selection inside the preview pane to a markdown source range.
 *
 * The `rehypeSourcePosition` plugin annotates rendered block elements with
 * `data-source-start`/`data-source-end` attributes carrying the absolute
 * character offsets of the originating mdast node. To resolve a selection,
 * we walk up from the selection's container to the nearest annotated block,
 * count characters within that block's text content up to the selection
 * endpoints, and add those counts to the block's source-start.
 *
 * Limitations: this counts rendered text characters, which only matches
 * source characters when the source has no markdown structural punctuation
 * inside the selection (no `*`, `_`, `[`, list markers, fence backticks, ...).
 * The most common selection — a span inside a paragraph — works reliably; we
 * fall back to returning `null` when the start and end resolve to different
 * blocks.
 */

import { useEffect, useState, type RefObject } from "react";

/** @public */
export type SelectionRange = {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly text: string;
  // Anchor point for positioning a UI affordance next to the selection. The
  // coordinates are relative to the preview container's scroll-content origin
  // (so they stay valid as the preview scrolls). `top` is the bottom of the
  // selection's last line; `left` is the selection's start x.
  readonly anchorTop: number;
  readonly anchorLeft: number;
};

const findAnnotatedAncestor = (node: Node | null): HTMLElement | null => {
  let current: Node | null = node;
  while (current !== null) {
    if (
      current instanceof HTMLElement &&
      current.hasAttribute("data-source-start")
    ) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
};

// Read the integer `data-original-length` attribute that `rehypeCriticmarkup`
// attaches to every rendered marker. The length is in ORIGINAL source
// characters, so the walker can advance past a marker without descending into
// its (potentially much longer) rendered children.
const readOriginalLength = (el: Element): number | null => {
  const raw = el.getAttribute("data-original-length");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

interface WalkResult {
  readonly total: number;
  readonly found: boolean;
}

const walkForOffset = (
  node: Node,
  container: Node,
  offset: number,
  total: number,
): WalkResult => {
  if (node === container && node instanceof Text) {
    return { total: total + offset, found: true };
  }
  if (node instanceof Text) {
    return { total: total + node.data.length, found: false };
  }
  if (node instanceof Element) {
    const originalLength = readOriginalLength(node);
    if (originalLength !== null && !node.contains(container)) {
      // Skip marker subtree entirely; advance by its original-source length so
      // downstream offsets land back in the unmarked-source coordinate space.
      return { total: total + originalLength, found: false };
    }
  }
  let running = total;
  for (const child of Array.from(node.childNodes)) {
    const r = walkForOffset(child, container, offset, running);
    if (r.found) return r;
    running = r.total;
  }
  return { total: running, found: false };
};

const offsetWithin = (
  block: HTMLElement,
  container: Node,
  offset: number,
): number | null => {
  const result = walkForOffset(block, container, offset, 0);
  return result.found ? result.total : null;
};

const isInsidePre = (node: Node): boolean => {
  // Walk to the nearest Element to call closest('pre'). Selection containers
  // are usually Text nodes, which do not have closest().
  const el = node instanceof Element ? node : node.parentElement;
  if (el === null) return false;
  return el.closest("pre") !== null;
};

const isInsideCommentAnchor = (node: Node): boolean => {
  // Suppress new-comment selections that fall inside an existing
  // `<mark class="vd-comment-anchor">` so a second comment cannot be
  // inserted in a way that would corrupt the wrapping marker.
  const el = node instanceof Element ? node : node.parentElement;
  if (el === null) return false;
  return el.closest("mark.vd-comment-anchor") !== null;
};

const computeAnchor = (
  range: Range,
  root: HTMLElement,
): { anchorTop: number; anchorLeft: number } => {
  // jsdom does not implement Range.getBoundingClientRect; guard so unit tests
  // that exercise the resolver against synthetic DOMs keep working. In real
  // browsers the method always exists.
  if (typeof range.getBoundingClientRect !== "function") {
    return { anchorTop: 0, anchorLeft: 0 };
  }
  const rangeRect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    anchorTop: rangeRect.bottom - rootRect.top + root.scrollTop,
    anchorLeft: rangeRect.left - rootRect.left + root.scrollLeft,
  };
};

/** @public */
export const resolveSelection = (
  range: Range,
  root: HTMLElement,
): SelectionRange | null => {
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }
  // Selections inside a <pre> (fenced code blocks, including the Mermaid
  // wrapper <pre><div class="md-mermaid">...</pre>) are routed to the
  // block-level comment trigger, so we suppress the inline mapping here.
  if (isInsidePre(range.startContainer) || isInsidePre(range.endContainer)) {
    return null;
  }
  if (
    isInsideCommentAnchor(range.startContainer) ||
    isInsideCommentAnchor(range.endContainer)
  ) {
    return null;
  }
  const startBlock = findAnnotatedAncestor(range.startContainer);
  const endBlock = findAnnotatedAncestor(range.endContainer);
  if (startBlock === null || endBlock === null) return null;
  if (startBlock !== endBlock) return null;
  // The annotation plugin only sets data-source-start with a numeric value, so
  // parseInt always succeeds when the attribute is present.
  const blockStart = Number.parseInt(
    startBlock.getAttribute("data-source-start") ?? "0",
    10,
  );
  const startOffset = offsetWithin(
    startBlock,
    range.startContainer,
    range.startOffset,
  );
  const endOffset = offsetWithin(
    startBlock,
    range.endContainer,
    range.endOffset,
  );
  if (startOffset === null || endOffset === null) return null;
  if (startOffset === endOffset) return null;
  const text = range.toString();
  const { anchorTop, anchorLeft } = computeAnchor(range, root);
  return {
    sourceStart: blockStart + startOffset,
    sourceEnd: blockStart + endOffset,
    text,
    anchorTop,
    anchorLeft,
  };
};

/** @public */
export const useTextSelection = (
  rootRef: RefObject<HTMLElement | null>,
): SelectionRange | null => {
  const [range, setRange] = useState<SelectionRange | null>(null);
  useEffect(() => {
    const handler = (): void => {
      const root = rootRef.current;
      if (root === null) {
        setRange(null);
        return;
      }
      const sel = window.getSelection();
      if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) {
        setRange(null);
        return;
      }
      const r = sel.getRangeAt(0);
      setRange(resolveSelection(r, root));
    };
    document.addEventListener("selectionchange", handler);
    return () => {
      document.removeEventListener("selectionchange", handler);
    };
  }, [rootRef]);
  return range;
};
