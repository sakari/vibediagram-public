/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import type { Root as HastRoot, Element, Text, RootContent } from "hast";
import {
  preprocessCriticMarkup,
  PLACEHOLDER_PATTERN,
  mapProcessedToOriginal,
  type MarkerInfo,
} from "./preprocess";
import {
  escapeHighlightExact,
  serializeInlineBody,
  serializeBlockBody,
  type Message,
} from "./grammar";
import { rehypeCriticmarkup } from "./rehype-criticmarkup";

const arbText = fc
  .string({ unit: "grapheme", minLength: 1, maxLength: 40 })
  .filter((s) => s === s.trim() && s.length > 0);
const arbExact = fc
  .string({ unit: "grapheme", minLength: 1, maxLength: 30 })
  .filter((s) => !s.includes("\n"));
const arbHandle = fc.stringMatching(/^[A-Za-z0-9_.-]{1,8}$/);
const arbId = fc.stringMatching(/^[a-z0-9]{1,6}$/);
const arbMessage: fc.Arbitrary<Message> = fc.record({
  author: arbHandle,
  ts: fc.constant("2026-05-09"),
  text: arbText,
});

const formatInlineMarker = (
  id: string,
  exact: string,
  msg: Message,
): string => {
  const body = serializeInlineBody({
    id,
    resolved: false,
    messages: [msg],
  });
  return `{==${escapeHighlightExact(exact)}==}{>>${body}<<}`;
};

const formatBlockMarker = (id: string, msg: Message): string => {
  const body = serializeBlockBody({
    id,
    resolved: false,
    target: "next",
    messages: [msg],
  });
  return `{>>${body}<<}`;
};

const containsMarker = (s: string): boolean =>
  /\{==[\s\S]*?==\}\{>>[\s\S]*?<<\}/.test(s) || /\{>>[\s\S]*?<<\}/.test(s);

const arbProse = fc
  .string({ unit: "grapheme", minLength: 0, maxLength: 40 })
  .filter((s) => !containsMarker(s));

// `unified().runSync(...)` returns a generic Node. Validate the root type at
// runtime and use a type predicate so we never narrow with an unsafe cast.
const isHastRoot = (node: unknown): node is HastRoot => {
  if (typeof node !== "object" || node === null) return false;
  const candidate = node as { type?: unknown };
  return candidate.type === "root";
};

const expectRoot = (node: unknown): HastRoot => {
  if (!isHastRoot(node)) {
    throw new Error("expected hast root from unified pipeline");
  }
  return node;
};

const buildHast = (source: string): HastRoot => {
  const mdast = unified().use(remarkParse).use(remarkGfm).parse(source);
  return expectRoot(unified().use(remarkRehype).runSync(mdast));
};

// Run the rehype plugin against a pre-built hast tree by piping it through a
// fresh unified processor — this avoids hand-typing the Plugin contract.
const applyRehype = (
  markers: ReadonlyMap<string, MarkerInfo>,
  tree: HastRoot,
): HastRoot =>
  expectRoot(unified().use(rehypeCriticmarkup(markers)).runSync(tree));

const collectPlaceholderIds = (root: HastRoot): Set<string> => {
  const seen = new Set<string>();
  const visit = (node: HastRoot | Element | Text | RootContent): void => {
    if (node.type === "text") {
      PLACEHOLDER_PATTERN.lastIndex = 0;
      for (;;) {
        const m = PLACEHOLDER_PATTERN.exec(node.value);
        if (m === null) break;
        seen.add(m[2]);
      }
      return;
    }
    if (node.type === "element" || node.type === "root") {
      for (const c of node.children) visit(c);
    }
  };
  visit(root);
  return seen;
};

const findMarkElement = (root: HastRoot, threadId: string): Element | null => {
  let found: Element | null = null;
  const visit = (node: HastRoot | Element | Text | RootContent): void => {
    if (found !== null) return;
    if (
      node.type === "element" &&
      node.tagName === "mark" &&
      node.properties["data-thread-id"] === threadId
    ) {
      found = node;
      return;
    }
    if (node.type === "element" || node.type === "root") {
      for (const c of node.children) visit(c);
    }
  };
  visit(root);
  return found;
};

describe("property: preprocessCriticMarkup", () => {
  it("recovers a single inline marker from arbitrary (exact, message)", () => {
    fc.assert(
      fc.property(arbId, arbExact, arbMessage, (id, exact, msg) => {
        const marker = formatInlineMarker(id, exact, msg);
        const { source, markers } = preprocessCriticMarkup(marker);
        expect(markers.size).toBe(1);
        const [info] = markers.values();
        expect(info.kind).toBe("inline");
        if (info.kind !== "inline") throw new Error("expected inline");
        expect(info.exact).toBe(exact);
        expect(info.thread.messages).toHaveLength(1);
        expect(info.thread.messages[0].text).toBe(msg.text);
        expect(info.thread.messages[0].author).toBe(msg.author);
        expect(source.includes("{==")).toBe(false);
        expect(source.includes("<<}")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("recovers a single block marker", () => {
    fc.assert(
      fc.property(arbId, arbMessage, (id, msg) => {
        const marker = formatBlockMarker(id, msg);
        const { source, markers } = preprocessCriticMarkup(marker);
        expect(markers.size).toBe(1);
        const [info] = markers.values();
        if (info.kind !== "block") throw new Error("expected block");
        expect(info.thread.messages[0].text).toBe(msg.text);
        expect(source.includes("<<}")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("preserves prose around markers and produces exactly the right count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbId, arbExact, arbMessage), {
          minLength: 0,
          maxLength: 4,
        }),
        arbProse,
        arbProse,
        (cases, lead, tail) => {
          const seen = new Set<string>();
          const markerStrs: string[] = [];
          for (const [id, exact, msg] of cases) {
            if (seen.has(id)) continue;
            seen.add(id);
            markerStrs.push(formatInlineMarker(id, exact, msg));
          }
          const src = `${lead}\n\n${markerStrs.join("\n\n")}\n\n${tail}`;
          const { source, markers: out } = preprocessCriticMarkup(src);
          expect(out.size).toBe(markerStrs.length);
          expect(source.includes(lead)).toBe(true);
          expect(source.includes(tail)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("placeholders survive remark-parse + remark-gfm + remark-rehype", () => {
    fc.assert(
      fc.property(arbId, arbExact, arbMessage, (id, exact, msg) => {
        const src = `paragraph before\n\n${formatInlineMarker(id, exact, msg)}\n\nafter`;
        const { source, markers } = preprocessCriticMarkup(src);
        expect(markers.size).toBe(1);
        const seenIds = collectPlaceholderIds(buildHast(source));
        for (const placeholderId of markers.keys()) {
          expect(seenIds.has(placeholderId)).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("mapProcessedToOriginal recovers original byte positions for prose", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbId, arbExact, arbMessage), {
          minLength: 0,
          maxLength: 4,
        }),
        arbProse,
        arbProse,
        (cases, lead, tail) => {
          const seen = new Set<string>();
          // Build an original source where each prose segment is followed by
          // a marker (when present) so we can later check the offset for an
          // arbitrary character in the prose maps back through the marker
          // boundaries correctly.
          const segments: Array<{ prose: string; marker: string | null }> = [];
          segments.push({ prose: lead, marker: null });
          for (const [id, exact, msg] of cases) {
            if (seen.has(id)) continue;
            seen.add(id);
            segments.push({
              prose: " ",
              marker: formatInlineMarker(id, exact, msg),
            });
          }
          segments.push({ prose: tail, marker: null });
          let original = "";
          for (const seg of segments) {
            original += seg.prose;
            if (seg.marker !== null) original += seg.marker;
          }
          const { source: processed, markerSpans } =
            preprocessCriticMarkup(original);
          // Walk every prose character and verify the round-trip.
          let processedCursor = 0;
          let originalCursor = 0;
          for (const seg of segments) {
            for (let i = 0; i < seg.prose.length; i += 1) {
              const recovered = mapProcessedToOriginal(
                processedCursor + i,
                markerSpans,
              );
              expect(recovered).toBe(originalCursor + i);
            }
            processedCursor += seg.prose.length;
            originalCursor += seg.prose.length;
            if (seg.marker !== null) {
              // Skip the placeholder length on the processed side and the
              // marker length on the original side.
              const span = markerSpans.find(
                (s) => s.processedStart === processedCursor,
              );
              if (span === undefined) {
                // Should never happen given how we built `segments`.
                throw new Error("missing span at processed cursor");
              }
              processedCursor = span.processedEnd;
              originalCursor = span.originalEnd;
            }
          }
          expect(processed.length).toBe(processedCursor);
          expect(original.length).toBe(originalCursor);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("rehypeCriticmarkup turns placeholders into <mark> elements", () => {
    fc.assert(
      fc.property(arbId, arbExact, arbMessage, (id, exact, msg) => {
        const src = `prose ${formatInlineMarker(id, exact, msg)} more`;
        const { source, markers } = preprocessCriticMarkup(src);
        expect(markers.size).toBe(1);
        const tree = applyRehype(markers, buildHast(source));
        const [info] = markers.values();
        expect(findMarkElement(tree, info.thread.id)).not.toBeNull();
      }),
      { numRuns: 50 },
    );
  });
});

describe("preprocess: critical bug-fix scenarios", () => {
  it("preserves a literal `<<}` inside the body without breaking the marker", () => {
    const text = "contains <<} text";
    const body = serializeInlineBody({
      id: "c1",
      resolved: false,
      messages: [{ author: "a", ts: "2026", text }],
    });
    const src = `before {==hello==}{>>${body}<<} after`;
    const { source, markers } = preprocessCriticMarkup(src);
    expect(markers.size).toBe(1);
    const [info] = markers.values();
    if (info.kind !== "inline") throw new Error("expected inline");
    expect(info.thread.messages[0].text).toBe(text);
    expect(source.includes("<<}")).toBe(false);
  });

  it("preserves a literal `==}` inside the highlighted exact", () => {
    const exact = "contains ==} text";
    const escaped = escapeHighlightExact(exact);
    const body = "id:c2 | by:@a 2026: hi";
    const src = `before {==${escaped}==}{>>${body}<<} after`;
    const { source, markers } = preprocessCriticMarkup(src);
    expect(markers.size).toBe(1);
    const [info] = markers.values();
    if (info.kind !== "inline") throw new Error("expected inline");
    expect(info.exact).toBe(exact);
    expect(source.includes("==}")).toBe(false);
  });

  it("regex terminates quickly on adversarial backslash-escape input", () => {
    const body = "\\<".repeat(5000) + "<<}";
    const src = `before {==${escapeHighlightExact("x")}==}{>>id:c1 | by:@a 2026: ${body} rest`;
    const start = Date.now();
    preprocessCriticMarkup(src);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("escaped body text round-trips through the preprocessor", () => {
    const adversarial = "line1\nline2 | piped \\ <<} done";
    const body = serializeInlineBody({
      id: "c1",
      resolved: false,
      messages: [{ author: "a", ts: "2026", text: adversarial }],
    });
    const src = `{==hi==}{>>${body}<<}`;
    const { markers } = preprocessCriticMarkup(src);
    const [info] = markers.values();
    if (info.kind !== "inline") throw new Error("expected inline");
    expect(info.thread.messages[0].text).toBe(adversarial);
  });
});
