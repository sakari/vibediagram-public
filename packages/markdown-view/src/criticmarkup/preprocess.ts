/**
 * Source-level CriticMarkup preprocessor.
 *
 * Why this exists: `remark-parse` strips backslash escapes that appear in front
 * of ASCII punctuation BEFORE any custom mdast transformer runs, so an mdast
 * plugin sees a body that already lost its `\<<}` and `\==\}` escapes. To keep
 * the wire-form escapes meaningful we must scan the raw source string before
 * markdown is parsed, replace each marker with an opaque placeholder that
 * traverses `remark-parse` + `remark-gfm` unchanged, and re-attach the marker
 * as a `<mark>`/`<div>` element via a rehype plugin afterwards.
 *
 * The placeholder format is `H<id>` for inline highlights and
 * `B<id>` for block markers. Both are Unicode Private Use Area
 * sentinels that markdown does not interpret.
 *
 * Malformed marker bodies are left untouched so the user still sees the
 * literal text and can fix the syntax.
 */

import {
  generateId,
  parseBlockBody,
  parseInlineBody,
  unescapeHighlightExact,
  type BlockThread,
  type InlineThread,
} from "./grammar";

/** @public */
export type MarkerInfo =
  | {
      readonly kind: "inline";
      readonly thread: InlineThread;
      readonly exact: string;
    }
  | { readonly kind: "block"; readonly thread: BlockThread };

/**
 * One entry per marker recovered from the input source. The four offsets pin
 * down the marker in both coordinate spaces so consumers can translate offsets
 * captured against the processed source (what `react-markdown` parses) back to
 * the original source (what CodeMirror dispatches into).
 *
 * Iteration order matches source order, which the mapper helpers rely on.
 *
 * @public
 */
export type MarkerSpan = {
  /** Inclusive start offset in the original source. */
  readonly originalStart: number;
  /** Exclusive end offset in the original source. */
  readonly originalEnd: number;
  /** Inclusive start offset in the processed source (the placeholder). */
  readonly processedStart: number;
  /** Exclusive end offset in the processed source (the placeholder). */
  readonly processedEnd: number;
  /** Placeholder id (also the key into the marker map). */
  readonly id: string;
};

/** @public */
export type PreprocessResult = {
  /** Source with each marker replaced by a placeholder. */
  readonly source: string;
  /** Marker info keyed by placeholder id. Iteration order = source order. */
  readonly markers: ReadonlyMap<string, MarkerInfo>;
  /** Marker spans in source order, pairing original and processed offsets. */
  readonly markerSpans: readonly MarkerSpan[];
};

// Inline highlight + comment pair. The body capture allows newlines and skips
// backslash-escaped close markers. Each branch consumes at least one char so
// the regex stays linear under adversarial input. The same shape is used by
// `useThreads`, `repair`, and the legacy mdast plugin; keeping them in sync is
// what lets the wire-format escapes round-trip end-to-end.
const HIGHLIGHT_PATTERN =
  /\{==((?:\\.|[^\\=]|=(?!=\}))*?)==\}\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;

// Standalone block-comment marker. Matches both real block markers and the
// comment half of an inline pair; the post-filter on the preceding `}` rules
// out the false positives.
const STANDALONE_BLOCK_PATTERN = /\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;

const PLACEHOLDER_OPEN = "";
const PLACEHOLDER_CLOSE = "";

/** Placeholder regex. Exposed for the rehype plugin. */
export const PLACEHOLDER_PATTERN = /([HB])([A-Za-z0-9]+)/g;

/** @public */
export type PlaceholderKind = "inline" | "block";

const buildPlaceholder = (kind: PlaceholderKind, id: string): string =>
  `${PLACEHOLDER_OPEN}${kind === "inline" ? "H" : "B"}${id}${PLACEHOLDER_CLOSE}`;

interface Match {
  readonly start: number;
  readonly end: number;
  readonly placeholder: string;
  readonly info: MarkerInfo;
}

const tryInlineMatch = (
  m: RegExpExecArray,
  usedIds: Set<string>,
): Match | null => {
  const exactRaw = m[1];
  const bodyRaw = m[2];
  // `parseInlineBody` unescapes message text segments internally; we must
  // pass the wire form so the per-segment splitter can honour ` \| ` escapes.
  const thread = parseInlineBody(bodyRaw);
  if (thread === null) return null;
  const id = uniqueId(usedIds);
  return {
    start: m.index,
    end: m.index + m[0].length,
    placeholder: buildPlaceholder("inline", id),
    info: {
      kind: "inline",
      thread,
      exact: unescapeHighlightExact(exactRaw),
    },
  };
};

const tryBlockMatch = (
  source: string,
  m: RegExpExecArray,
  usedIds: Set<string>,
): Match | null => {
  // Skip the comment half of an inline `{==...==}{>>...<<}` pair: those
  // matches are always preceded by the `}` that closes the highlight.
  if (m.index > 0 && source.charAt(m.index - 1) === "}") return null;
  const bodyRaw = m[1];
  const thread = parseBlockBody(bodyRaw);
  if (thread === null) return null;
  const id = uniqueId(usedIds);
  return {
    start: m.index,
    end: m.index + m[0].length,
    placeholder: buildPlaceholder("block", id),
    info: { kind: "block", thread },
  };
};

const uniqueId = (used: Set<string>): string => {
  // We use a fresh `generateId` (6 base32 chars) for placeholders rather than
  // reusing the thread id — multiple markers might share an id at parse time
  // and the placeholder must be unique within the preprocess result.
  for (;;) {
    const candidate = generateId();
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
};

const collectMatches = (source: string): Match[] => {
  const usedIds = new Set<string>();
  const inline: Match[] = [];
  HIGHLIGHT_PATTERN.lastIndex = 0;
  for (;;) {
    const m = HIGHLIGHT_PATTERN.exec(source);
    if (m === null) break;
    const hit = tryInlineMatch(m, usedIds);
    if (hit !== null) inline.push(hit);
  }

  const block: Match[] = [];
  STANDALONE_BLOCK_PATTERN.lastIndex = 0;
  for (;;) {
    const m = STANDALONE_BLOCK_PATTERN.exec(source);
    if (m === null) break;
    // Skip standalone hits that overlap an inline pair (the comment half).
    const overlaps = inline.some(
      (h) => m.index < h.end && m.index + m[0].length > h.start,
    );
    if (overlaps) continue;
    const hit = tryBlockMatch(source, m, usedIds);
    if (hit !== null) block.push(hit);
  }

  return [...inline, ...block].sort((a, b) => a.start - b.start);
};

/**
 * Replace every recognised CriticMarkup marker in `source` with an opaque
 * placeholder. Returns the rewritten source plus a map keyed by the
 * placeholder id that lets the rehype plugin reconstruct the marker.
 *
 * Malformed markers are left as literal text. The function is O(n) over the
 * source length and resists catastrophic backtracking.
 *
 * @public
 */
export const preprocessCriticMarkup = (source: string): PreprocessResult => {
  const matches = collectMatches(source);
  if (matches.length === 0) {
    return { source, markers: new Map(), markerSpans: [] };
  }
  const markers = new Map<string, MarkerInfo>();
  const markerSpans: MarkerSpan[] = [];
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    out += source.slice(cursor, m.start);
    const processedStart = out.length;
    out += m.placeholder;
    const processedEnd = out.length;
    const idMatch = /[HB]([A-Za-z0-9]+)/.exec(m.placeholder);
    /* v8 ignore next 2 */
    if (idMatch === null) continue;
    const id = idMatch[1];
    markers.set(id, m.info);
    markerSpans.push({
      originalStart: m.start,
      originalEnd: m.end,
      processedStart,
      processedEnd,
      id,
    });
    cursor = m.end;
  }
  out += source.slice(cursor);
  return { source: out, markers, markerSpans };
};

/**
 * Translate an offset captured against the processed source back to the
 * original source. `markerSpans` must be in ascending source order, which is
 * the order `preprocessCriticMarkup` always produces.
 *
 * - Offsets in unmarked text map by adding the cumulative shift introduced by
 *   all markers that precede them.
 * - An offset at a placeholder boundary maps to the corresponding marker
 *   boundary in the original source.
 * - An offset that falls inside a placeholder maps to the marker's
 *   `originalEnd` (just past the marker), so callers never produce an insert
 *   position that splits a marker.
 *
 * @public
 */
export const mapProcessedToOriginal = (
  offset: number,
  markerSpans: readonly MarkerSpan[],
): number => {
  let shift = 0;
  for (const span of markerSpans) {
    if (offset <= span.processedStart) {
      return offset + shift;
    }
    if (offset < span.processedEnd) {
      // Inside a placeholder. Clamp past the marker so the caller never
      // inserts inside an existing marker.
      return span.originalEnd;
    }
    shift +=
      span.originalEnd -
      span.originalStart -
      (span.processedEnd - span.processedStart);
  }
  return offset + shift;
};

/**
 * Translate a processed-source range to the original source by mapping each
 * endpoint independently.
 *
 * @public
 */
export const mapProcessedRangeToOriginal = (
  range: { readonly start: number; readonly end: number },
  markerSpans: readonly MarkerSpan[],
): { readonly start: number; readonly end: number } => ({
  start: mapProcessedToOriginal(range.start, markerSpans),
  end: mapProcessedToOriginal(range.end, markerSpans),
});
