/**
 * Scan the rendered preview DOM for thread anchors and join them with the
 * full thread metadata parsed from the markdown source.
 *
 * The remark plugin emits only the thread id on the DOM element to keep the
 * rendered markup small; messages, authors, and resolved-state live in the
 * source body. This hook re-parses the body for each anchor so the margin
 * overlay can render full thread bubbles.
 */

import { useEffect, useState, type RefObject } from "react";
import {
  parseInlineBody,
  parseBlockBody,
  type InlineThread,
  type BlockThread,
} from "../criticmarkup";
import type { SourceRange, ThreadMarker } from "./types";

// Body capture allows newlines and skips backslash-escaped close markers.
// Each branch consumes one char so the regex stays linear. Same shape as
// `preprocess.ts`, `commands.ts`, and `repair.ts`.
const HIGHLIGHT_PATTERN =
  /\{==((?:\\.|[^\\=]|=(?!=\}))*?)==\}\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;
const BLOCK_PATTERN = /\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;

type InlineEntry = {
  thread: InlineThread;
  range: SourceRange;
};
type BlockEntry = {
  thread: BlockThread;
  range: SourceRange;
};

const indexInlineThreads = (source: string): Map<string, InlineEntry> => {
  const out = new Map<string, InlineEntry>();
  HIGHLIGHT_PATTERN.lastIndex = 0;
  for (;;) {
    const m = HIGHLIGHT_PATTERN.exec(source);
    if (m === null) break;
    const body = m[2];
    const thread = parseInlineBody(body);
    if (thread === null) continue;
    out.set(thread.id, {
      thread,
      range: { start: m.index, end: m.index + m[0].length },
    });
  }
  return out;
};

const indexBlockThreads = (source: string): Map<string, BlockEntry> => {
  const out = new Map<string, BlockEntry>();
  BLOCK_PATTERN.lastIndex = 0;
  for (;;) {
    const m = BLOCK_PATTERN.exec(source);
    if (m === null) break;
    // Skip the comment half of an inline `{==...==}{>>...<<}` pair: those
    // matches are always preceded by a `}`. Without this guard a malformed
    // inline body could be picked up here as a block thread.
    if (m.index > 0 && source.charAt(m.index - 1) === "}") continue;
    const body = m[1];
    const thread = parseBlockBody(body);
    if (thread === null) continue;
    out.set(thread.id, {
      thread,
      range: { start: m.index, end: m.index + m[0].length },
    });
  }
  return out;
};

const collectMarkers = (
  root: HTMLElement,
  inline: Map<string, InlineEntry>,
  block: Map<string, BlockEntry>,
): ThreadMarker[] => {
  const elements = root.querySelectorAll<HTMLElement>("[data-thread-id]");
  const out: ThreadMarker[] = [];
  for (const el of elements) {
    // Selector filters by attribute presence so dataset.threadId is set.
    const id = el.dataset.threadId ?? "";
    const blockEntry = block.get(id);
    if (blockEntry !== undefined && el.classList.contains("vd-block-comment")) {
      // The block marker div is rendered with display:none, so its bounding
      // rect is zero. Resolve the anchor to the adjacent block element the
      // marker targets so the margin bubble can position against real
      // geometry. Fall back to the marker if the sibling is missing.
      const sibling =
        blockEntry.thread.target === "next"
          ? el.nextElementSibling
          : el.previousElementSibling;
      const anchorEl = sibling instanceof HTMLElement ? sibling : el;
      out.push({
        id,
        kind: "block",
        thread: blockEntry.thread,
        anchorEl,
        sourceRange: blockEntry.range,
      });
      continue;
    }
    const inlineEntry = inline.get(id);
    if (inlineEntry !== undefined) {
      out.push({
        id,
        kind: "inline",
        thread: inlineEntry.thread,
        anchorEl: el,
        sourceRange: inlineEntry.range,
      });
    }
  }
  return out;
};

/** @public */
export const scanThreads = (
  root: HTMLElement,
  source: string,
): ThreadMarker[] => {
  const inline = indexInlineThreads(source);
  const block = indexBlockThreads(source);
  return collectMarkers(root, inline, block);
};

/** @public */
export const useThreads = (
  rootRef: RefObject<HTMLElement | null>,
  source: string,
): ThreadMarker[] => {
  const [markers, setMarkers] = useState<ThreadMarker[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      setMarkers([]);
      return;
    }
    const rescan = (): void => {
      setMarkers(scanThreads(root, source));
    };
    rescan();
    const observer = new MutationObserver(rescan);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-thread-id", "data-resolved"],
    });
    return () => {
      observer.disconnect();
    };
  }, [rootRef, source]);

  return markers;
};
