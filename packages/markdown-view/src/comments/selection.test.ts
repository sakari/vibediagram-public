/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { resolveSelection, useTextSelection } from "./selection";

afterEach(() => {
  cleanup();
});

const buildBlock = (
  text: string,
  start: number,
  end: number,
): { root: HTMLElement; textNode: Text } => {
  const root = document.createElement("div");
  const p = document.createElement("p");
  p.setAttribute("data-source-start", String(start));
  p.setAttribute("data-source-end", String(end));
  const tn = document.createTextNode(text);
  p.appendChild(tn);
  root.appendChild(p);
  document.body.appendChild(root);
  return { root, textNode: tn };
};

describe("resolveSelection", () => {
  it("[sel-basic] maps a selection inside a paragraph to source offsets", () => {
    const { root, textNode } = buildBlock("Hello world", 100, 111);
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    const sel = resolveSelection(range, root);
    expect(sel).not.toBeNull();
    expect(sel?.sourceStart).toBe(106);
    expect(sel?.sourceEnd).toBe(111);
    expect(sel?.text).toBe("world");
  });

  it("[sel-collapsed] returns null when start equals end", () => {
    const { root, textNode } = buildBlock("abc", 0, 3);
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 1);
    expect(resolveSelection(range, root)).toBeNull();
  });

  it("[sel-cross-block] returns null when start and end are in different blocks", () => {
    const root = document.createElement("div");
    const p1 = document.createElement("p");
    p1.setAttribute("data-source-start", "0");
    p1.setAttribute("data-source-end", "3");
    const t1 = document.createTextNode("aaa");
    p1.appendChild(t1);
    const p2 = document.createElement("p");
    p2.setAttribute("data-source-start", "10");
    p2.setAttribute("data-source-end", "13");
    const t2 = document.createTextNode("bbb");
    p2.appendChild(t2);
    root.append(p1, p2);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(t1, 0);
    range.setEnd(t2, 3);
    expect(resolveSelection(range, root)).toBeNull();
  });

  it("[sel-outside] returns null when the range is outside the root", () => {
    const { textNode } = buildBlock("hello", 0, 5);
    const otherRoot = document.createElement("div");
    document.body.appendChild(otherRoot);
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 1);
    expect(resolveSelection(range, otherRoot)).toBeNull();
  });

  it("[sel-no-block] returns null when ancestor lacks data-source-start", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    const tn = document.createTextNode("plain");
    p.appendChild(tn);
    root.appendChild(p);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 5);
    expect(resolveSelection(range, root)).toBeNull();
  });

  it("[sel-hook-collapsed] hook returns null when selection is collapsed", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(root);
      return useTextSelection(ref);
    });
    act(() => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current).toBeNull();
  });

  it("[sel-hook-active] hook returns a range for a non-collapsed selection in an annotated block", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.setAttribute("data-source-start", "0");
    p.setAttribute("data-source-end", "5");
    const tn = document.createTextNode("hello");
    p.appendChild(tn);
    root.appendChild(p);
    document.body.appendChild(root);
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(root);
      return useTextSelection(ref);
    });
    act(() => {
      const range = document.createRange();
      range.setStart(tn, 0);
      range.setEnd(tn, 5);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current?.text).toBe("hello");
  });

  it("[sel-hook-no-root] hook returns null when ref is null", () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(null);
      return useTextSelection(ref);
    });
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current).toBeNull();
  });

  it("[sel-inside-pre] returns null when the selection is inside a <pre>", () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.setAttribute("data-source-start", "0");
    pre.setAttribute("data-source-end", "10");
    const code = document.createElement("code");
    const tn = document.createTextNode("const x");
    code.appendChild(tn);
    pre.appendChild(code);
    root.appendChild(pre);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 5);
    expect(resolveSelection(range, root)).toBeNull();
  });

  it("[sel-inside-pre-element] suppresses when the start container itself is the <pre> element", () => {
    // Cover the branch where range.startContainer is an Element rather than
    // a Text node — the `closest('pre')` check must still hit.
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.setAttribute("data-source-start", "0");
    pre.setAttribute("data-source-end", "10");
    const code = document.createElement("code");
    code.appendChild(document.createTextNode("const x"));
    pre.appendChild(code);
    root.appendChild(pre);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(pre, 0);
    range.setEnd(pre, 1);
    expect(resolveSelection(range, root)).toBeNull();
  });

  it("[sel-inside-anchor] returns null when the selection is inside an existing comment mark", () => {
    // A new selection that overlaps an already-commented `<mark>` would
    // produce nested CriticMarkup if it were converted into a new comment.
    // The guard suppresses such ranges so the popover never offers it.
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.setAttribute("data-source-start", "0");
    p.setAttribute("data-source-end", "20");
    const before = document.createTextNode("Hi ");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    const inside = document.createTextNode("there");
    mark.appendChild(inside);
    const after = document.createTextNode(" friend");
    p.append(before, mark, after);
    root.appendChild(p);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(inside, 0);
    range.setEnd(inside, 5);
    expect(resolveSelection(range, root)).toBeNull();
  });

  it("[sel-end-inside-anchor] returns null when only the end container sits inside a comment mark", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.setAttribute("data-source-start", "0");
    p.setAttribute("data-source-end", "20");
    const before = document.createTextNode("Hi ");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    const inside = document.createTextNode("there");
    mark.appendChild(inside);
    p.append(before, mark);
    root.appendChild(p);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(inside, 3);
    expect(resolveSelection(range, root)).toBeNull();
  });

  it("[sel-bad-original-length] ignores a non-numeric data-original-length attribute", () => {
    // Defensive coverage for malformed attribute values: when the integer is
    // unparseable the walker falls through to the rendered-text path so the
    // selection still resolves (just to a possibly-wrong offset).
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.setAttribute("data-source-start", "0");
    p.setAttribute("data-source-end", "10");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    mark.setAttribute("data-original-length", "not-a-number");
    mark.appendChild(document.createTextNode("hi"));
    const after = document.createTextNode(" rest");
    p.append(mark, after);
    root.appendChild(p);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(after, 1);
    range.setEnd(after, 5);
    const sel = resolveSelection(range, root);
    // Length of the rendered "hi" (2) + leading space at index 1 = 3.
    expect(sel?.sourceStart).toBe(3);
    expect(sel?.sourceEnd).toBe(7);
  });

  it("[sel-empty-sibling] tolerates sibling subtrees that do not contain the target", () => {
    // Hits the walker's exhaust-loop path: the <span> sibling has no
    // data-original-length and no descendants that match the container, so
    // the recursive walk completes without finding it before the next child
    // (the trailing text) succeeds.
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.setAttribute("data-source-start", "0");
    p.setAttribute("data-source-end", "10");
    const empty = document.createElement("span");
    const after = document.createTextNode("xy");
    p.append(empty, after);
    root.appendChild(p);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(after, 0);
    range.setEnd(after, 2);
    const sel = resolveSelection(range, root);
    expect(sel?.sourceStart).toBe(0);
    expect(sel?.sourceEnd).toBe(2);
  });

  it("[sel-after-marker] counts a marker by data-original-length, not by rendered text", () => {
    // Reproduces the `a x` -> comment a -> comment x bug: after commenting
    // the `a`, the paragraph contains a 33-char wire-form marker followed by
    // ` x`. A subsequent selection of `x` must resolve to the original
    // offset (34..35), not the rendered offset (2..3).
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.setAttribute("data-source-start", "0");
    // The end attribute is unused by offsetWithin, set it for realism.
    p.setAttribute("data-source-end", "36");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    mark.setAttribute("data-thread-id", "c1");
    mark.setAttribute("data-original-length", "33");
    // Rendered text inside the marker is just the highlighted exact `a`.
    mark.appendChild(document.createTextNode("a"));
    const after = document.createTextNode(" x");
    p.append(mark, after);
    root.appendChild(p);
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(after, 1); // before `x`
    range.setEnd(after, 2); // after `x`
    const sel = resolveSelection(range, root);
    expect(sel?.sourceStart).toBe(34);
    expect(sel?.sourceEnd).toBe(35);
    expect(sel?.text).toBe("x");
  });

  it("[sel-multi-text] maps offset across multiple text nodes inside a block", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.setAttribute("data-source-start", "50");
    p.setAttribute("data-source-end", "60");
    const t1 = document.createTextNode("abc");
    const em = document.createElement("em");
    const t2 = document.createTextNode("def");
    em.appendChild(t2);
    const t3 = document.createTextNode("gh");
    p.append(t1, em, t3);
    root.appendChild(p);
    document.body.appendChild(root);
    const range = document.createRange();
    // Select "cdef" — offset 2 in t1 to offset 3 in t2
    range.setStart(t1, 2);
    range.setEnd(t2, 3);
    const sel = resolveSelection(range, root);
    expect(sel?.sourceStart).toBe(52);
    expect(sel?.sourceEnd).toBe(56);
  });
});
