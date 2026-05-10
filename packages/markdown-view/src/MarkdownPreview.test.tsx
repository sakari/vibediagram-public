/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { CoordTransform } from "@diagram/draw-overlay";

afterEach(() => {
  cleanup();
});

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: StubResizeObserver });

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
  },
}));

import { MarkdownPreview } from "./MarkdownPreview";

const SOURCE = `# Heading

- item one
- item two

| col a | col b |
| ----- | ----- |
| 1     | 2     |

\`\`\`ts
const x = 1;
\`\`\`

\`\`\`mermaid
graph TD; A-->B;
\`\`\`
`;

describe("MarkdownPreview", () => {
  it("[mp-mixed] renders heading, list, GFM table, fenced code, and mermaid placeholder", async () => {
    const { container } = render(<MarkdownPreview source={SOURCE} />);
    // Heading from markdown
    expect(container.querySelector("h1")).not.toBeNull();
    // List from markdown
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
    // GFM table
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("thead")).not.toBeNull();
    // Non-mermaid fenced block renders a <code> element
    const codes = container.querySelectorAll("code");
    expect(codes.length).toBeGreaterThan(0);
    // Wait for MermaidBlock's deferred render so the post-test promise
    // resolution doesn't leak into the next test as an act() warning.
    await waitFor(() => {
      const block = container.querySelector(".md-mermaid");
      expect(block).not.toBeNull();
      expect(block!.querySelector("svg")).not.toBeNull();
    });
  });

  // Covers the className=undefined branch (`className ?? ""`) and the
  // no-language match branch in the custom `code` component, which would
  // otherwise be reachable only via inline code without a language fence.
  it("[mp-inline-code] renders inline code without a language as <code>", () => {
    const { container } = render(
      <MarkdownPreview source={"Some `inline` code."} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("inline");
  });

  // Without renderOverlay, the inner overlay-anchor wrapper must not
  // appear so the existing DOM contract (and any visual baseline that
  // depends on it) is unchanged.
  it("[mp-no-overlay] does not render the .md-preview-content wrapper when renderOverlay is omitted", () => {
    const { container } = render(<MarkdownPreview source="# x" />);
    expect(container.querySelector(".md-preview-content")).toBeNull();
    expect(container.querySelector(".md-preview")).not.toBeNull();
    expect(container.querySelector("h1")).not.toBeNull();
  });

  // The transform handed to renderOverlay is the contract this preview
  // exposes. We capture it and then exercise the contract directly.
  it("[mp-overlay-transform] passes a CoordTransform whose toContent returns a non-null point", () => {
    let captured: CoordTransform | null = null;
    const { container } = render(
      <MarkdownPreview
        source="# x"
        renderOverlay={(transform) => {
          captured = transform;
          return <div data-testid="overlay" />;
        }}
      />,
    );
    expect(container.querySelector(".md-preview-content")).not.toBeNull();
    expect(container.querySelector('[data-testid="overlay"]')).not.toBeNull();
    expect(captured).not.toBeNull();
    const point = captured!.toContent(0, 0);
    expect(point).not.toBeNull();
    expect(typeof point!.x).toBe("number");
    expect(typeof point!.y).toBe("number");
    const screen = captured!.toScreen(0, 0);
    expect(screen).not.toBeNull();
    expect(typeof screen!.left).toBe("number");
    expect(typeof screen!.top).toBe("number");
  });

  // Subscribing to the transform must surface scroll events on the
  // outer .md-preview container so the overlay can re-render its
  // anchored strokes.
  it("[mp-overlay-scroll] notifies subscribers when the scroll container scrolls", () => {
    let captured: CoordTransform | null = null;
    const { container } = render(
      <MarkdownPreview
        source="# x"
        renderOverlay={(transform) => {
          captured = transform;
          return null;
        }}
      />,
    );
    const scrollEl = container.querySelector(".md-preview");
    expect(scrollEl).not.toBeNull();
    expect(captured).not.toBeNull();
    const cb = vi.fn();
    const unsubscribe = captured!.subscribe(cb);
    fireEvent.scroll(scrollEl!);
    expect(cb).toHaveBeenCalledTimes(1);
    // Unsubscribe stops further notifications.
    unsubscribe();
    fireEvent.scroll(scrollEl!);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // The transform may outlive the component if a consumer holds a
  // reference to it (e.g. inside a closure). After unmount, the
  // scroll container ref is detached, so the transform must safely
  // return null rather than throwing.
  it("[mp-overlay-detached] toContent/toScreen return null after unmount", () => {
    let captured: CoordTransform | null = null;
    const { unmount } = render(
      <MarkdownPreview
        source="# x"
        renderOverlay={(transform) => {
          captured = transform;
          return null;
        }}
      />,
    );
    expect(captured).not.toBeNull();
    unmount();
    expect(captured!.toContent(0, 0)).toBeNull();
    expect(captured!.toScreen(0, 0)).toBeNull();
  });

  it("[mp-critic-inline] renders an inline highlight with a margin bubble", () => {
    const src =
      "Hello {==world==}{>>id:abc | by:@alice 2026-01-01T00:00Z: hi<<} done.";
    const { container } = render(<MarkdownPreview source={src} />);
    const mark = container.querySelector("mark.vd-comment-anchor");
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("data-thread-id")).toBe("abc");
    expect(container.querySelector(".vd-comment-margin")).not.toBeNull();
  });

  it("[mp-critic-block] renders a block sentinel for a standalone block marker", () => {
    const src =
      "{>>block id:bk target:next | by:@a 2026-01-01: x<<}\n\n```ts\ncode\n```\n";
    const { container } = render(<MarkdownPreview source={src} />);
    expect(
      container.querySelector(".vd-block-comment[data-thread-id='bk']"),
    ).not.toBeNull();
  });

  it("[mp-critic-toggle] clicking the highlight expands the bubble", () => {
    const src = "Hello {==world==}{>>id:abc | by:@a 2026-01-01: hi<<} done.";
    const { container } = render(<MarkdownPreview source={src} />);
    const mark = container.querySelector("mark.vd-comment-anchor");
    expect(mark).not.toBeNull();
    fireEvent.click(mark!);
    expect(
      container.querySelector(".vd-comment-bubble--expanded"),
    ).not.toBeNull();
    fireEvent.click(mark!);
    expect(container.querySelector(".vd-comment-bubble--expanded")).toBeNull();
  });

  it("[mp-critic-write] passing editorView shows the new-comment trigger", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "hello world" }),
    });
    const { container } = render(
      <MarkdownPreview source="hello world" editorView={view} />,
    );
    // Simulate a selection that resolves to a source range.
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    const tn = p!.firstChild;
    if (!(tn instanceof Text)) throw new Error("expected text node");
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 5);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    // Need to wait for state update
    return waitFor(() => {
      expect(
        container.querySelector(".vd-new-comment-trigger") ??
          container.querySelector(".vd-new-comment-popover"),
      ).not.toBeNull();
    });
  });

  it("[mp-critic-submit] submitting through the popover wraps the source range", async () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "hello world" }),
    });
    const { container } = render(
      <MarkdownPreview
        source="hello world"
        editorView={view}
        currentAuthor="alice"
      />,
    );
    const p = container.querySelector("p")!;
    const tn = p.firstChild;
    if (!(tn instanceof Text)) throw new Error("expected text node");
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 5);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    const trigger = await waitFor(() => {
      const t = container.querySelector(".vd-new-comment-trigger");
      expect(t).not.toBeNull();
      return t!;
    });
    fireEvent.click(trigger);
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "feedback" } });
    fireEvent.click(container.querySelector("button[type='submit']")!);
    expect(view.state.doc.toString()).toContain("{==hello==}{>>id:");
  });

  it("[mp-critic-second-comment] inserting a second comment after an existing marker lands at the original offset", async () => {
    // Reproduces the `a x` -> comment a -> comment x bug. The first marker
    // already wraps `a`, and the user now selects `x`. The popover must
    // dispatch into CodeMirror at original-source offsets 34..35 — i.e.
    // outside the existing 33-char marker — instead of corrupting it.
    const initialMarker = "{==a==}{>>id:c1 | by:@a 2026: t<<}";
    expect(initialMarker.length).toBe(34);
    const initialDoc = `${initialMarker} x`;
    const view = new EditorView({
      state: EditorState.create({ doc: initialDoc }),
    });
    const { container } = render(
      <MarkdownPreview
        source={initialDoc}
        editorView={view}
        currentAuthor="alice"
      />,
    );
    const p = container.querySelector("p")!;
    // The paragraph's last text node is ` x` (after the rendered <mark>).
    const lastChild = p.lastChild;
    if (!(lastChild instanceof Text)) {
      throw new Error("expected trailing text node");
    }
    const range = document.createRange();
    range.setStart(lastChild, 1); // before `x`
    range.setEnd(lastChild, 2); // after `x`
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    const trigger = await waitFor(() => {
      const t = container.querySelector(".vd-new-comment-trigger");
      expect(t).not.toBeNull();
      return t!;
    });
    fireEvent.click(trigger);
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "new" } });
    fireEvent.click(container.querySelector("button[type='submit']")!);
    const result = view.state.doc.toString();
    // The original marker must remain intact and the new marker must wrap `x`.
    expect(result.startsWith(initialMarker)).toBe(true);
    expect(result).toContain("{==x==}{>>id:");
    // Sanity-check: nothing got inserted inside the existing marker body.
    expect(result).not.toContain("====}");
  });

  it("[mp-author-fallback] falls back to anonymous when currentAuthor missing", () => {
    const src = "Hi {==there==}{>>id:zz | by:@a 2026-01-01: x<<}.";
    const { container } = render(<MarkdownPreview source={src} />);
    expect(container.querySelector("mark.vd-comment-anchor")).not.toBeNull();
  });

  it("[mp-block-trigger] renders a block-level Comment trigger for a fenced code block", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "```ts\nconst x = 1;\n```\n" }),
    });
    const { container } = render(
      <MarkdownPreview
        source={"```ts\nconst x = 1;\n```\n"}
        editorView={view}
      />,
    );
    const trigger = container.querySelector(".vd-block-trigger");
    expect(trigger).not.toBeNull();
    // The trigger must live next to a <pre> inside the position-relative
    // wrapper so the absolute placement resolves against the block.
    const wrapper = trigger!.closest(".vd-block-trigger-wrapper");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("pre")).not.toBeNull();
  });

  it("[mp-block-trigger-no-view] does not render a block trigger without an editorView", () => {
    const { container } = render(
      <MarkdownPreview source={"```ts\nconst x = 1;\n```\n"} />,
    );
    expect(container.querySelector(".vd-block-trigger")).toBeNull();
  });

  it("[mp-pre-suppresses-inline] selecting text inside a <pre> does not show the inline popover", () => {
    const src = "```ts\nconst x = 1;\n```\n";
    const view = new EditorView({
      state: EditorState.create({ doc: src }),
    });
    const { container } = render(
      <MarkdownPreview source={src} editorView={view} />,
    );
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    const tn = code!.firstChild;
    if (!(tn instanceof Text)) throw new Error("expected text node");
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 5);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    // After the selection event fires, the inline trigger/form must remain
    // absent — block-level commenting is the only path inside <pre>.
    return waitFor(() => {
      expect(container.querySelector(".vd-new-comment-trigger")).toBeNull();
      expect(container.querySelector(".vd-new-comment-popover")).toBeNull();
    });
  });

  it("[mp-block-existing] block trigger reuses an existing block thread and shows the Open comment label", async () => {
    const src =
      "{>>block id:cX target:next | by:@a 2026-01-01: t<<}\n\n```ts\nconst x = 1;\n```\n";
    const view = new EditorView({ state: EditorState.create({ doc: src }) });
    const { container } = render(
      <MarkdownPreview source={src} editorView={view} currentAuthor="alice" />,
    );
    // Wait for useThreads' DOM scan to populate markers and the trigger to
    // re-render in "Open comment" mode.
    const trigger = await waitFor(() => {
      const t = container.querySelector(".vd-block-trigger");
      expect(t).not.toBeNull();
      expect(t!.textContent).toBe("Open comment");
      return t!;
    });
    fireEvent.click(trigger);
    // Activating the existing thread expands its margin bubble.
    await waitFor(() => {
      expect(
        container.querySelector(".vd-comment-bubble--expanded"),
      ).not.toBeNull();
    });
  });

  it("[mp-block-second-noop] clicking the trigger on a block that already has a thread does not insert a second marker", async () => {
    const src =
      "{>>block id:cX target:next | by:@a 2026-01-01: t<<}\n\n```ts\nconst x = 1;\n```\n";
    const view = new EditorView({ state: EditorState.create({ doc: src }) });
    const before = view.state.doc.toString();
    const { container } = render(
      <MarkdownPreview source={src} editorView={view} currentAuthor="alice" />,
    );
    const trigger = await waitFor(() => {
      const t = container.querySelector(".vd-block-trigger");
      expect(t).not.toBeNull();
      expect(t!.textContent).toBe("Open comment");
      return t!;
    });
    fireEvent.click(trigger);
    // No new {>>block...<<} marker should have been inserted into the source.
    expect(view.state.doc.toString()).toBe(before);
    expect(container.querySelector(".vd-block-trigger-popover")).toBeNull();
  });

  it("[mp-block-trigger-submit] submitting through the block trigger inserts a block marker", () => {
    const src = "```ts\nconst x = 1;\n```\n";
    const view = new EditorView({
      state: EditorState.create({ doc: src }),
    });
    const { container } = render(
      <MarkdownPreview source={src} editorView={view} currentAuthor="alice" />,
    );
    const trigger = container.querySelector(".vd-block-trigger");
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    const ta = container.querySelector(".vd-block-trigger-popover textarea");
    if (!(ta instanceof HTMLTextAreaElement))
      throw new Error("expected textarea");
    fireEvent.change(ta, { target: { value: "review please" } });
    const submit = container.querySelector(
      ".vd-block-trigger-popover button[type='submit']",
    );
    fireEvent.click(submit!);
    expect(view.state.doc.toString()).toMatch(
      /\{>>block id:[a-z0-9]+ target:next.*: review please<<\}\n\n```ts/,
    );
  });
});
