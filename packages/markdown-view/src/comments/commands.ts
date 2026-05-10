/**
 * CodeMirror edit commands that mutate the markdown source so that the
 * CriticMarkup comment UI flows are simple text edits.
 *
 * All commands dispatch a single transaction on the supplied `EditorView`,
 * keeping undo history coherent and routing the change through the same
 * Jazz-backed plain-text CRDT that powers the editor.
 */

import type { EditorView } from "@codemirror/view";
import {
  escapeBodyText,
  escapeHighlightExact,
  generateId,
  parseBlockBody,
  parseInlineBody,
  serializeBlockBody,
  serializeInlineBody,
  type BlockTarget,
  type Message,
} from "../criticmarkup";

// Body capture allows newlines and skips backslash-escaped close markers.
// Each branch consumes one char so the regex stays linear under adversarial
// input. The same shape is used by `preprocess`, `useThreads`, and `repair`.
const HIGHLIGHT_PATTERN =
  /\{==((?:\\.|[^\\=]|=(?!=\}))*?)==\}\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;
const BLOCK_PATTERN = /\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;

const nowIso = (): string => new Date().toISOString();

/** @public */
export type InsertInlineRange = {
  readonly sourceStart: number;
  readonly sourceEnd: number;
};

/** @public */
export const insertInlineComment = (
  view: EditorView,
  range: InsertInlineRange,
  body: string,
  author: string,
): string => {
  const doc = view.state.doc.toString();
  const exactRaw = doc.slice(range.sourceStart, range.sourceEnd);
  const id = generateId();
  const msg: Message = { author, ts: nowIso(), text: body };
  const initial = serializeInlineBody({
    id,
    resolved: false,
    messages: [msg],
  });
  // Escape any literal `==}` or `\` inside the highlighted source range so
  // the resulting `{==…==}` slot still has unambiguous bounds. The
  // preprocessor reverses this with `unescapeHighlightExact`.
  const exact = escapeHighlightExact(exactRaw);
  const replacement = `{==${exact}==}{>>${initial}<<}`;
  view.dispatch({
    changes: {
      from: range.sourceStart,
      to: range.sourceEnd,
      insert: replacement,
    },
  });
  return id;
};

/** @public */
export const insertBlockComment = (
  view: EditorView,
  blockSourceLine: number,
  target: BlockTarget,
  body: string,
  author: string,
): string => {
  const id = generateId();
  const msg: Message = { author, ts: nowIso(), text: body };
  const initial = serializeBlockBody({
    id,
    resolved: false,
    target,
    messages: [msg],
  });
  const marker = `{>>${initial}<<}`;
  const line = view.state.doc.line(blockSourceLine);
  // Insert on the line preceding (target:next) or following (target:prev) the
  // referenced block, separated by a blank line so the marker lives in its own
  // paragraph and the remark plugin can recognize it as a standalone block.
  if (target === "next") {
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: `${marker}\n\n` },
    });
  } else {
    view.dispatch({
      changes: { from: line.to, to: line.to, insert: `\n\n${marker}` },
    });
  }
  return id;
};

type Located = {
  readonly kind: "inline" | "block";
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly body: string;
};

const locateThread = (doc: string, threadId: string): Located | null => {
  HIGHLIGHT_PATTERN.lastIndex = 0;
  for (;;) {
    const m = HIGHLIGHT_PATTERN.exec(doc);
    if (m === null) break;
    const body = m[2];
    const parsed = parseInlineBody(body);
    if (parsed === null) continue;
    if (parsed.id !== threadId) continue;
    const wholeStart = m.index;
    const bodyStart =
      wholeStart + m[0].indexOf("{>>", m[1].length) + "{>>".length;
    const bodyEnd = bodyStart + body.length;
    return { kind: "inline", bodyStart, bodyEnd, body };
  }
  BLOCK_PATTERN.lastIndex = 0;
  for (;;) {
    const m = BLOCK_PATTERN.exec(doc);
    if (m === null) break;
    // BLOCK_PATTERN matches both standalone block markers and the comment half
    // of an inline `{==...==}{>>...<<}` pair. The character preceding the
    // comment half is always the `}` that closes the highlight; skip those
    // hits so the locator only operates on real block markers.
    if (m.index > 0 && doc.charAt(m.index - 1) === "}") continue;
    const body = m[1];
    const parsed = parseBlockBody(body);
    if (parsed === null) continue;
    if (parsed.id !== threadId) continue;
    const bodyStart = m.index + "{>>".length;
    const bodyEnd = bodyStart + body.length;
    return { kind: "block", bodyStart, bodyEnd, body };
  }
  return null;
};

/** @public */
export const appendThreadReply = (
  view: EditorView,
  threadId: string,
  body: string,
  author: string,
): boolean => {
  const doc = view.state.doc.toString();
  const located = locateThread(doc, threadId);
  if (located === null) return false;
  const msg: Message = { author, ts: nowIso(), text: body };
  // Insert the new ` | by:@... <ts>: <text>` segment at the closing `<<}` of
  // the body span. A zero-length insert (rather than a full body rewrite)
  // preserves any concurrent CRDT edits that might land inside the existing
  // body characters.
  // The serializer-side `escapeText` keeps the segment safe to embed inside
  // the body span: newlines, ` | `, and `<<}` in the user's text are escaped
  // so the surrounding marker still parses correctly after the insert.
  const segment = ` | by:@${author} ${msg.ts}: ${escapeBodyText(msg.text)}`;
  view.dispatch({
    changes: { from: located.bodyEnd, to: located.bodyEnd, insert: segment },
  });
  return true;
};

const RESOLVED_TRUE = " resolved:true";
const RESOLVED_FALSE = " resolved:false";

/**
 * Find the start of the ` resolved:<value>` token (including the leading
 * space) inside a body. Returns null when the body has no explicit token.
 *
 * Searched as a substring of the body so the returned offset can be added
 * directly to `bodyStart` to obtain a document-absolute position.
 */
const findResolvedToken = (
  body: string,
): { from: number; to: number; value: "true" | "false" } | null => {
  const trueIdx = body.indexOf(RESOLVED_TRUE);
  if (trueIdx >= 0) {
    return {
      from: trueIdx,
      to: trueIdx + RESOLVED_TRUE.length,
      value: "true",
    };
  }
  const falseIdx = body.indexOf(RESOLVED_FALSE);
  if (falseIdx >= 0) {
    return {
      from: falseIdx,
      to: falseIdx + RESOLVED_FALSE.length,
      value: "false",
    };
  }
  return null;
};

/**
 * Locate the end of the `id:<id>` token within a body. The id token is
 * required by the grammar so this always succeeds when the body has
 * already been parsed. Returns the body-relative offset.
 */
const idTokenEnd = (body: string, id: string): number => {
  const needle = `id:${id}`;
  const idx = body.indexOf(needle);
  /* v8 ignore next */
  if (idx < 0) return -1;
  return idx + needle.length;
};

/** @public */
export const toggleThreadResolved = (
  view: EditorView,
  threadId: string,
): boolean => {
  const doc = view.state.doc.toString();
  const located = locateThread(doc, threadId);
  if (located === null) return false;
  // `locateThread` only returns successfully-parsed bodies, so re-parsing
  // here is guaranteed to succeed. The fallback is unreachable but kept as
  // a runtime invariant guard.
  const parsed =
    located.kind === "inline"
      ? parseInlineBody(located.body)
      : parseBlockBody(located.body);
  /* v8 ignore next */
  if (parsed === null) return false;

  const existing = findResolvedToken(located.body);
  if (existing !== null) {
    // Replace only the `true`/`false` literal so concurrent edits elsewhere in
    // the body remain untouched. The literal sits at the tail of the matched
    // token: ` resolved:<value>` -> value starts at to - value.length.
    const valueLen = existing.value.length;
    const valueFromBody = existing.to - valueLen;
    const flipped = existing.value === "true" ? "false" : "true";
    view.dispatch({
      changes: {
        from: located.bodyStart + valueFromBody,
        to: located.bodyStart + existing.to,
        insert: flipped,
      },
    });
    return true;
  }

  // No explicit `resolved:` token means the thread is currently false (the
  // grammar default). Insert ` resolved:true` immediately after the
  // `id:<id>` token so the resulting header stays grammar-valid.
  const insertAt = idTokenEnd(located.body, parsed.id);
  /* v8 ignore next */
  if (insertAt < 0) return false;
  view.dispatch({
    changes: {
      from: located.bodyStart + insertAt,
      to: located.bodyStart + insertAt,
      insert: RESOLVED_TRUE,
    },
  });
  return true;
};
