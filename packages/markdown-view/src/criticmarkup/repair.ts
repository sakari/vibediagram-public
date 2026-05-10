/**
 * Conservative repair pass over a markdown source containing CriticMarkup
 * comment markers. Detects malformed markers, renumbers duplicate ids, and
 * infers a missing `target:next` for block markers that sit immediately above
 * a fenced code block. Never deletes user content.
 */

import {
  parseBlockBody,
  parseInlineBody,
  serializeBlockBody,
  serializeInlineBody,
  generateId,
} from "./grammar";
import type { BlockThread, InlineThread } from "./grammar";

/** @public */
export interface Issue {
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

/** @public */
export interface RepairResult {
  readonly source: string;
  readonly issues: readonly Issue[];
}

interface Position {
  readonly line: number;
  readonly column: number;
}

const offsetToPosition = (source: string, offset: number): Position => {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
};

// Body capture allows newlines and skips backslash-escaped close markers.
// Each branch consumes one char so the regex stays linear. Same shape as
// `preprocess.ts`, `commands.ts`, and `useThreads.ts`.
const HIGHLIGHT_PAIR =
  /\{==((?:\\.|[^\\=]|=(?!=\}))*?)==\}\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;
const STANDALONE_COMMENT = /\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/g;
const OPEN_HIGHLIGHT = /\{==/g;
const OPEN_COMMENT = /\{>>/g;
const CLOSE_HIGHLIGHT = /==\}/g;
const CLOSE_COMMENT = /<<\}/g;

interface InlineHit {
  readonly start: number;
  readonly end: number;
  readonly exact: string;
  readonly body: string;
}

interface BlockHit {
  readonly start: number;
  readonly end: number;
  readonly body: string;
}

const findInlineHits = (source: string): InlineHit[] => {
  HIGHLIGHT_PAIR.lastIndex = 0;
  const out: InlineHit[] = [];
  for (;;) {
    const m = HIGHLIGHT_PAIR.exec(source);
    if (m === null) break;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      exact: m[1],
      body: m[2],
    });
  }
  return out;
};

const findStandaloneBlockHits = (
  source: string,
  consumed: ReadonlyArray<{ start: number; end: number }>,
): BlockHit[] => {
  STANDALONE_COMMENT.lastIndex = 0;
  const out: BlockHit[] = [];
  for (;;) {
    const m = STANDALONE_COMMENT.exec(source);
    if (m === null) break;
    const start = m.index;
    const end = start + m[0].length;
    const overlaps = consumed.some(
      (range) => start < range.end && end > range.start,
    );
    if (overlaps) continue;
    out.push({ start, end, body: m[1] });
  }
  return out;
};

const countMatches = (source: string, pattern: RegExp): number => {
  pattern.lastIndex = 0;
  let n = 0;
  for (;;) {
    const m = pattern.exec(source);
    if (m === null) break;
    n += 1;
  }
  return n;
};

const dedupeId = (id: string, used: Set<string>): string => {
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${id}-${generateId().slice(0, 3)}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fresh = generateId();
  used.add(fresh);
  return fresh;
};

const looksLikeFenceFollowing = (source: string, end: number): boolean => {
  let i = end;
  let newlines = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n") {
      newlines += 1;
      if (newlines > 2) return false;
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i += 1;
      continue;
    }
    break;
  }
  return source.startsWith("```", i) || source.startsWith("~~~", i);
};

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const applyReplacements = (
  source: string,
  replacements: readonly Replacement[],
): string => {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    out += source.slice(cursor, r.start);
    out += r.text;
    cursor = r.end;
  }
  out += source.slice(cursor);
  return out;
};

// Reports any unbalanced open/close marker counts as `issues`. Extracted to keep
// `repairCriticMarkup` under the eslint complexity budget.
const checkBalance = (source: string, issues: Issue[]): void => {
  const openHi = countMatches(source, OPEN_HIGHLIGHT);
  const closeHi = countMatches(source, CLOSE_HIGHLIGHT);
  const openCo = countMatches(source, OPEN_COMMENT);
  const closeCo = countMatches(source, CLOSE_COMMENT);
  if (openHi !== closeHi) {
    issues.push({
      line: 1,
      column: 1,
      code: "unclosed-highlight",
      message: `Unbalanced {== / ==} markers: ${String(openHi)} open vs ${String(closeHi)} close`,
    });
  }
  if (openCo !== closeCo) {
    issues.push({
      line: 1,
      column: 1,
      code: "unclosed-comment",
      message: `Unbalanced {>> / <<} markers: ${String(openCo)} open vs ${String(closeCo)} close`,
    });
  }
};

// Reports `{==...==}` highlights that are not followed by a `{>>...<<}` pair.
const reportLonelyHighlights = (
  source: string,
  inlineHits: readonly InlineHit[],
  issues: Issue[],
): void => {
  const lonelyPattern = /\{==((?:\\.|[^\\=]|=(?!=\}))*?)==\}/g;
  for (;;) {
    const m = lonelyPattern.exec(source);
    if (m === null) break;
    const start = m.index;
    const end = start + m[0].length;
    const paired = inlineHits.some((h) => h.start === start);
    if (!paired) {
      const pos = offsetToPosition(source, start);
      issues.push({
        line: pos.line,
        column: pos.column,
        code: "highlight-without-comment",
        message: "Highlight {==...==} is not followed by {>>...<<}",
      });
    } else {
      lonelyPattern.lastIndex = end;
    }
  }
};

// Walks the inline highlight+comment hits, recording malformed bodies and
// scheduling replacements for any duplicate ids.
const processInlineHits = (
  source: string,
  inlineHits: readonly InlineHit[],
  usedIds: Set<string>,
  issues: Issue[],
  replacements: Replacement[],
): void => {
  for (const hit of inlineHits) {
    const thread = parseInlineBody(hit.body);
    if (thread === null) {
      const pos = offsetToPosition(source, hit.start);
      issues.push({
        line: pos.line,
        column: pos.column,
        code: "malformed-inline",
        message: "Malformed inline comment body",
      });
      continue;
    }
    const dedupedId = dedupeId(thread.id, usedIds);
    if (dedupedId !== thread.id) {
      const renamed: InlineThread = { ...thread, id: dedupedId };
      const newBody = serializeInlineBody(renamed);
      const newText = `{==${hit.exact}==}{>>${newBody}<<}`;
      replacements.push({ start: hit.start, end: hit.end, text: newText });
      const pos = offsetToPosition(source, hit.start);
      issues.push({
        line: pos.line,
        column: pos.column,
        code: "duplicate-id",
        message: `Duplicate id ${thread.id} renumbered to ${dedupedId}`,
      });
    }
  }
};

interface BlockParseOutcome {
  readonly thread: BlockThread | null;
  readonly inferred: boolean;
}

// Tries to parse a block body, falling back to inferring `target:next` when
// the marker sits directly above a fenced code block.
const parseBlockHitBody = (
  source: string,
  hit: BlockHit,
): BlockParseOutcome => {
  const direct = parseBlockBody(hit.body);
  if (direct !== null) return { thread: direct, inferred: false };
  const tokens = hit.body.trim().split(/\s+/);
  const isBlock = tokens[0] === "block";
  const hasTarget = tokens.some((t) => t.startsWith("target:"));
  if (!isBlock || hasTarget || !looksLikeFenceFollowing(source, hit.end)) {
    return { thread: null, inferred: false };
  }
  const repaired = hit.body.replace(/^(\s*block\s+)/, "$1target:next ");
  const reparsed = parseBlockBody(repaired);
  if (reparsed === null) return { thread: null, inferred: false };
  return { thread: reparsed, inferred: true };
};

// Walks block-comment hits, recording malformed/inferred outcomes and
// scheduling rewrites for inferred targets and duplicate ids.
const processBlockHits = (
  source: string,
  blockHits: readonly BlockHit[],
  usedIds: Set<string>,
  issues: Issue[],
  replacements: Replacement[],
): void => {
  for (const hit of blockHits) {
    const { thread, inferred } = parseBlockHitBody(source, hit);
    if (thread === null) {
      const pos = offsetToPosition(source, hit.start);
      issues.push({
        line: pos.line,
        column: pos.column,
        code: "malformed-block",
        message: "Malformed block comment body",
      });
      continue;
    }
    if (inferred) {
      const pos = offsetToPosition(source, hit.start);
      issues.push({
        line: pos.line,
        column: pos.column,
        code: "missing-target-inferred",
        message: "Inferred missing target:next on block comment above fence",
      });
    }
    const dedupedId = dedupeId(thread.id, usedIds);
    const finalThread: BlockThread =
      dedupedId === thread.id ? thread : { ...thread, id: dedupedId };
    if (dedupedId !== thread.id) {
      const pos = offsetToPosition(source, hit.start);
      issues.push({
        line: pos.line,
        column: pos.column,
        code: "duplicate-id",
        message: `Duplicate id ${thread.id} renumbered to ${dedupedId}`,
      });
    }
    if (dedupedId !== thread.id || inferred) {
      const newBody = serializeBlockBody(finalThread);
      replacements.push({
        start: hit.start,
        end: hit.end,
        text: `{>>${newBody}<<}`,
      });
    }
  }
};

export const repairCriticMarkup = (source: string): RepairResult => {
  const issues: Issue[] = [];
  const replacements: Replacement[] = [];
  const usedIds = new Set<string>();

  const inlineHits = findInlineHits(source);
  const blockHits = findStandaloneBlockHits(source, inlineHits);

  checkBalance(source, issues);
  reportLonelyHighlights(source, inlineHits, issues);
  processInlineHits(source, inlineHits, usedIds, issues, replacements);
  processBlockHits(source, blockHits, usedIds, issues, replacements);

  const next = applyReplacements(source, replacements);
  return { source: next, issues };
};
