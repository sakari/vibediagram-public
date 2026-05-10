/**
 * Rehype plugin that re-attaches CriticMarkup markers to the hast tree using
 * the marker map produced by `preprocessCriticMarkup`.
 *
 * The preprocessor replaced each marker with a Unicode-private-area
 * placeholder before `remark-parse` ran. That placeholder traveled as plain
 * text through `remark-parse`, `remark-gfm`, and `remark-rehype`. This plugin
 * walks the resulting hast tree and replaces the placeholders with hast
 * elements:
 *
 * - Inline highlight placeholders become a `<mark class="vd-comment-anchor">`
 *   carrying the thread id and resolved flag, with the highlighted `exact`
 *   text as a single text child. Markdown formatting INSIDE the highlight is
 *   intentionally not preserved — see `comments.md` for the rationale.
 * - Block-marker placeholders become a hidden `<div class="vd-block-comment">`
 *   carrying the thread id, target, and resolved flag. A paragraph that only
 *   contains a block placeholder is unwrapped so the resulting `<div>` sits
 *   directly under the document root next to the block it targets.
 *
 * Placeholders that have no entry in `markers` (e.g. produced by an unrelated
 * plugin emitting similar bytes) are left untouched.
 */

import type { Plugin } from "unified";
import type {
  Element as HastElement,
  Root as HastRoot,
  RootContent as HastRootContent,
  Text as HastText,
  ElementContent,
  Properties,
} from "hast";
import {
  PLACEHOLDER_PATTERN,
  type MarkerInfo,
  type MarkerSpan,
} from "./preprocess";

const buildHighlightElement = (
  exact: string,
  info: MarkerInfo & { kind: "inline" },
  originalLength: number | undefined,
): HastElement => ({
  type: "element",
  tagName: "mark",
  properties: {
    className: ["vd-comment-anchor"],
    "data-thread-id": info.thread.id,
    "data-critic": "highlight",
    "data-resolved": String(info.thread.resolved),
    ...(originalLength === undefined
      ? {}
      : { "data-original-length": String(originalLength) }),
  } satisfies Properties,
  children: [{ type: "text", value: exact }],
});

const buildBlockElement = (
  info: MarkerInfo & { kind: "block" },
  originalLength: number | undefined,
): HastElement => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["vd-block-comment"],
    "data-thread-id": info.thread.id,
    "data-target": info.thread.target,
    "data-resolved": String(info.thread.resolved),
    ...(originalLength === undefined
      ? {}
      : { "data-original-length": String(originalLength) }),
  } satisfies Properties,
  children: [],
});

interface SplitOutcome {
  readonly nodes: ElementContent[];
  /** True iff at least one placeholder was replaced. */
  readonly changed: boolean;
}

const splitTextNode = (
  text: HastText,
  markers: ReadonlyMap<string, MarkerInfo>,
  spansById: ReadonlyMap<string, MarkerSpan>,
): SplitOutcome => {
  const value = text.value;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  const out: ElementContent[] = [];
  let lastIndex = 0;
  let changed = false;
  for (;;) {
    const m = PLACEHOLDER_PATTERN.exec(value);
    if (m === null) break;
    const id = m[2];
    const info = markers.get(id);
    if (info === undefined) {
      // Unknown placeholder — leave it as text and keep scanning. The regex
      // global state advances past this match automatically.
      continue;
    }
    if (m.index > lastIndex) {
      out.push({ type: "text", value: value.slice(lastIndex, m.index) });
    }
    const span = spansById.get(id);
    const originalLength =
      span === undefined ? undefined : span.originalEnd - span.originalStart;
    if (info.kind === "inline") {
      out.push(buildHighlightElement(info.exact, info, originalLength));
    } else {
      // Inline-context block placeholder. Leaving a `<div>` here would create
      // invalid HTML inside a `<p>`; collapse to a marker-less mark element so
      // the thread is still discoverable while keeping HTML well-formed.
      out.push(buildBlockElement(info, originalLength));
    }
    lastIndex = m.index + m[0].length;
    changed = true;
  }
  if (!changed) return { nodes: [text], changed: false };
  if (lastIndex < value.length) {
    out.push({ type: "text", value: value.slice(lastIndex) });
  }
  return { nodes: out, changed: true };
};

const isBlockPlaceholderOnly = (
  paragraph: HastElement,
  markers: ReadonlyMap<string, MarkerInfo>,
): MarkerInfo | null => {
  if (paragraph.children.length !== 1) return null;
  const only = paragraph.children[0];
  if (only.type !== "text") return null;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  const m = PLACEHOLDER_PATTERN.exec(only.value);
  if (m === null) return null;
  // The text must be exactly the placeholder, with no surrounding chars.
  if (m.index !== 0 || m[0].length !== only.value.length) return null;
  const info = markers.get(m[2]);
  if (info === undefined || info.kind !== "block") return null;
  return info;
};

// Walks a Root and recursively transforms placeholders found in any text
// descendant. Splitting Root and Element handlers keeps each `parent.children`
// assignment well-typed without unsafe casts.
const transformElement = (
  parent: HastElement,
  markers: ReadonlyMap<string, MarkerInfo>,
  spansById: ReadonlyMap<string, MarkerSpan>,
): void => {
  const next: ElementContent[] = [];
  for (const child of parent.children) {
    if (child.type === "text") {
      const { nodes, changed } = splitTextNode(child, markers, spansById);
      if (changed) {
        for (const n of nodes) next.push(n);
        continue;
      }
    }
    if (child.type === "element") {
      transformElement(child, markers, spansById);
    }
    next.push(child);
  }
  parent.children = next;
};

// Look up the placeholder id inside a paragraph that has already been
// validated by `isBlockPlaceholderOnly` and return the marker's
// original-source length (or undefined if the span map does not have it).
const lookupOriginalLength = (
  paragraph: HastElement,
  spansById: ReadonlyMap<string, MarkerSpan>,
): number | undefined => {
  const only = paragraph.children[0];
  /* v8 ignore next 2 */
  if (only.type !== "text") return undefined;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  const m = PLACEHOLDER_PATTERN.exec(only.value);
  /* v8 ignore next 2 */
  if (m === null) return undefined;
  const span = spansById.get(m[2]);
  if (span === undefined) return undefined;
  return span.originalEnd - span.originalStart;
};

const transformRoot = (
  parent: HastRoot,
  markers: ReadonlyMap<string, MarkerInfo>,
  spansById: ReadonlyMap<string, MarkerSpan>,
): void => {
  const next: HastRootContent[] = [];
  for (const child of parent.children) {
    if (child.type === "element" && child.tagName === "p") {
      const blockInfo = isBlockPlaceholderOnly(child, markers);
      if (blockInfo !== null && blockInfo.kind === "block") {
        const originalLength = lookupOriginalLength(child, spansById);
        next.push(buildBlockElement(blockInfo, originalLength));
        continue;
      }
    }
    if (child.type === "text") {
      const { nodes, changed } = splitTextNode(child, markers, spansById);
      if (changed) {
        for (const n of nodes) next.push(n);
        continue;
      }
    }
    if (child.type === "element") {
      transformElement(child, markers, spansById);
    }
    next.push(child);
  }
  parent.children = next;
};

/**
 * Build a rehype plugin that uses `markers` to replace placeholders with hast
 * elements. The factory shape lets `MarkdownPreview` pass the per-render
 * marker map without recreating the plugin chain on every keystroke.
 *
 * `markerSpans` is optional; when supplied, every `<mark>` and `<div>` emitted
 * by the plugin carries a `data-original-length` attribute holding the
 * marker's length in the original (pre-preprocess) source. Selection mapping
 * uses that integer to count characters across markers without descending
 * into rendered marker children.
 *
 * @public
 */
export const rehypeCriticmarkup =
  (
    markers: ReadonlyMap<string, MarkerInfo>,
    markerSpans: readonly MarkerSpan[] = [],
  ): Plugin<[], HastRoot> =>
  () =>
  (tree: HastRoot): void => {
    if (markers.size === 0) return;
    const spansById = new Map<string, MarkerSpan>();
    for (const s of markerSpans) spansById.set(s.id, s);
    transformRoot(tree, markers, spansById);
  };
