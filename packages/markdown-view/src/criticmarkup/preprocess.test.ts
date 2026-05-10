/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  preprocessCriticMarkup,
  PLACEHOLDER_PATTERN,
  mapProcessedToOriginal,
  mapProcessedRangeToOriginal,
  type MarkerSpan,
} from "./preprocess";

describe("preprocessCriticMarkup", () => {
  it("returns the source unchanged when there are no markers", () => {
    const src = "Just plain markdown with no markers.";
    const r = preprocessCriticMarkup(src);
    expect(r.source).toBe(src);
    expect(r.markers.size).toBe(0);
  });

  it("replaces an inline highlight pair with a placeholder and records the marker", () => {
    const src = "Hello {==world==}{>>id:c1<<}!";
    const r = preprocessCriticMarkup(src);
    expect(r.markers.size).toBe(1);
    const [info] = r.markers.values();
    if (info.kind !== "inline") throw new Error("expected inline");
    expect(info.exact).toBe("world");
    expect(info.thread.id).toBe("c1");
    expect(r.source).toMatch(/^Hello [\s\S]+!$/);
    PLACEHOLDER_PATTERN.lastIndex = 0;
    const ph = PLACEHOLDER_PATTERN.exec(r.source);
    expect(ph).not.toBeNull();
    expect(ph?.[1]).toBe("H");
  });

  it("replaces a standalone block marker with a placeholder", () => {
    const src = "before\n\n{>>block id:c1 target:next<<}\n\nafter";
    const r = preprocessCriticMarkup(src);
    expect(r.markers.size).toBe(1);
    const [info] = r.markers.values();
    if (info.kind !== "block") throw new Error("expected block");
    expect(info.thread.target).toBe("next");
  });

  it("does not treat the comment half of an inline pair as a block", () => {
    const src = "x {==y==}{>>id:i1<<}";
    const r = preprocessCriticMarkup(src);
    expect(r.markers.size).toBe(1);
    const [info] = r.markers.values();
    expect(info.kind).toBe("inline");
  });

  it("leaves a malformed inline body as literal text", () => {
    const src = "Hello {==world==}{>>not a body<<}!";
    const r = preprocessCriticMarkup(src);
    expect(r.markers.size).toBe(0);
    expect(r.source).toBe(src);
  });

  it("leaves a malformed block body as literal text", () => {
    const src = "{>>also not a body<<}";
    const r = preprocessCriticMarkup(src);
    expect(r.markers.size).toBe(0);
    expect(r.source).toBe(src);
  });

  it("recovers a body that contains a literal `<<}` token", () => {
    // Reproduces the bug: typing `<<}` inside a body must not break the
    // marker after a wire-form escape.
    const body = "id:c1 | by:@a 2026: see \\<<} for syntax";
    const src = `before {==hi==}{>>${body}<<} after`;
    const r = preprocessCriticMarkup(src);
    expect(r.markers.size).toBe(1);
    const [info] = r.markers.values();
    if (info.kind !== "inline") throw new Error("expected inline");
    expect(info.thread.messages[0].text).toBe("see <<} for syntax");
  });

  it("recovers a highlighted exact that contains a literal `==}`", () => {
    const src = "x {==a \\==} b==}{>>id:c1<<} y";
    const r = preprocessCriticMarkup(src);
    expect(r.markers.size).toBe(1);
    const [info] = r.markers.values();
    if (info.kind !== "inline") throw new Error("expected inline");
    expect(info.exact).toBe("a ==} b");
  });

  it("handles multiple markers in source order", () => {
    const src =
      "{==a==}{>>id:c1<<} mid {==b==}{>>id:c2<<}\n\n{>>block id:c3 target:next<<}";
    const r = preprocessCriticMarkup(src);
    const ids = [...r.markers.values()].map((m) =>
      m.kind === "inline" ? m.thread.id : m.thread.id,
    );
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("populates markerSpans with paired original/processed offsets", () => {
    const src = "x {==a==}{>>id:c1<<} y";
    const r = preprocessCriticMarkup(src);
    expect(r.markerSpans).toHaveLength(1);
    const [span] = r.markerSpans;
    // The marker spans `{==a==}{>>id:c1<<}` starting at offset 2.
    expect(span.originalStart).toBe(2);
    expect(span.originalEnd).toBe(src.length - 2); // up to ' y'
    // After preprocessing the placeholder has a fixed length; sanity-check
    // that the processed offsets match what the source string actually shows.
    expect(r.source.slice(span.processedStart, span.processedEnd)).toBe(
      r.source.slice(2, r.source.length - 2),
    );
  });
});

describe("mapProcessedToOriginal", () => {
  // A pair of fixtures representing the running example
  //   src = "a x"
  // with one inline highlight inserted around `a` so the original source is
  //   `{==a==}{>>id:c1 | by:@a 2026: t<<} x`.
  // The 33-character marker leaves a 3-character placeholder behind.
  const fixture: readonly MarkerSpan[] = [
    {
      originalStart: 0,
      originalEnd: 33,
      processedStart: 0,
      processedEnd: 3,
      id: "abc",
    },
  ];

  it("returns the input when there are no markers", () => {
    expect(mapProcessedToOriginal(7, [])).toBe(7);
  });

  it("maps an offset before the first marker by identity", () => {
    const spans: readonly MarkerSpan[] = [
      {
        originalStart: 10,
        originalEnd: 20,
        processedStart: 5,
        processedEnd: 8,
        id: "x",
      },
    ];
    expect(mapProcessedToOriginal(3, spans)).toBe(3);
  });

  it("maps the placeholder start to the marker start", () => {
    expect(mapProcessedToOriginal(0, fixture)).toBe(0);
  });

  it("maps the placeholder end to the marker end", () => {
    expect(mapProcessedToOriginal(3, fixture)).toBe(33);
  });

  it("clamps offsets inside a placeholder to the marker end", () => {
    expect(mapProcessedToOriginal(1, fixture)).toBe(33);
    expect(mapProcessedToOriginal(2, fixture)).toBe(33);
  });

  it("translates offsets after a marker by the cumulative shift", () => {
    // Processed " x" begins right after the placeholder at processedOffset 3,
    // and corresponds to original offset 33. The space and `x` follow.
    expect(mapProcessedToOriginal(4, fixture)).toBe(34);
    expect(mapProcessedToOriginal(5, fixture)).toBe(35);
  });

  it("handles multiple markers in sequence", () => {
    // Two 33-char markers separated by ` `.
    const spans: readonly MarkerSpan[] = [
      {
        originalStart: 0,
        originalEnd: 33,
        processedStart: 0,
        processedEnd: 3,
        id: "a",
      },
      {
        originalStart: 34,
        originalEnd: 67,
        processedStart: 4,
        processedEnd: 7,
        id: "b",
      },
    ];
    expect(mapProcessedToOriginal(3, spans)).toBe(33); // end of marker 1
    expect(mapProcessedToOriginal(4, spans)).toBe(34); // start of marker 2
    expect(mapProcessedToOriginal(7, spans)).toBe(67); // end of marker 2
    expect(mapProcessedToOriginal(8, spans)).toBe(68); // text after
  });
});

describe("mapProcessedRangeToOriginal", () => {
  it("translates each endpoint independently", () => {
    const spans: readonly MarkerSpan[] = [
      {
        originalStart: 0,
        originalEnd: 33,
        processedStart: 0,
        processedEnd: 3,
        id: "a",
      },
    ];
    expect(mapProcessedRangeToOriginal({ start: 4, end: 5 }, spans)).toEqual({
      start: 34,
      end: 35,
    });
  });
});
