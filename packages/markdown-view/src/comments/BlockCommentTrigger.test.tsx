/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRef } from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BlockCommentTrigger } from "./BlockCommentTrigger";

afterEach(() => {
  cleanup();
});

const buildView = (doc: string): EditorView =>
  new EditorView({ state: EditorState.create({ doc }) });

describe("BlockCommentTrigger", () => {
  it("[bct-trigger] renders the trigger button initially", () => {
    const view = buildView("```ts\ncode\n```\n");
    const { container } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
      />,
    );
    expect(container.querySelector(".vd-block-trigger")).not.toBeNull();
  });

  it("[bct-open] clicking the trigger opens the form", () => {
    const view = buildView("```ts\ncode\n```\n");
    const { container, getByText } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
      />,
    );
    fireEvent.click(getByText("Comment"));
    expect(container.querySelector(".vd-block-trigger-popover")).not.toBeNull();
  });

  it("[bct-submit] submitting inserts a block-level marker on the line preceding the block", () => {
    // sourceStart=14 lands on the start of line 3 ("```ts...") in the doc
    // below — the marker should be inserted on that line with target:next.
    const doc = "para1\n\npara2\n```ts\ncode\n```\n";
    const view = buildView(doc);
    const sourceStart = doc.indexOf("```ts");
    const { container, getByText } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={sourceStart}
        currentAuthor="bob"
      />,
    );
    fireEvent.click(getByText("Comment"));
    const ta = container.querySelector("textarea");
    if (ta === null) throw new Error("expected textarea");
    fireEvent.change(ta, { target: { value: "needs review" } });
    fireEvent.click(getByText("Submit"));
    const out = view.state.doc.toString();
    expect(out).toMatch(
      /\{>>block id:[a-z0-9]+ target:next.*: needs review<<\}\n\n```ts/,
    );
    expect(out).toContain("by:@bob");
  });

  it("[bct-cancel] cancel button hides the form without inserting", () => {
    const view = buildView("```ts\ncode\n```\n");
    const initial = view.state.doc.toString();
    const { container, getByText } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
      />,
    );
    fireEvent.click(getByText("Comment"));
    fireEvent.click(getByText("Cancel"));
    expect(container.querySelector(".vd-block-trigger-popover")).toBeNull();
    expect(container.querySelector(".vd-block-trigger")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(initial);
  });

  it("[bct-empty] submitting an empty draft does not insert anything", () => {
    const view = buildView("```ts\ncode\n```\n");
    const initial = view.state.doc.toString();
    const { container, getByText } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
      />,
    );
    fireEvent.click(getByText("Comment"));
    const form = container.querySelector("form");
    if (form === null) throw new Error("expected form");
    fireEvent.submit(form);
    expect(view.state.doc.toString()).toBe(initial);
  });

  it("[bct-mousedown] trigger preventDefaults mousedown to keep selection intact", () => {
    const view = buildView("code");
    const { getByText } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
      />,
    );
    const trigger = getByText("Comment");
    const evt = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    trigger.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  // Build a DOM tree with: parent > [block-marker, wrapper(pre)]. The trigger
  // is rendered into the wrapper. The wrapperRef points at the wrapper so the
  // trigger's effect can scan the wrapper's previous sibling for an adjacent
  // block-comment marker.
  const buildAdjacentDom = (): {
    parent: HTMLElement;
    wrapper: HTMLElement;
    wrapperRef: ReturnType<typeof createRef<HTMLElement>>;
  } => {
    const parent = document.createElement("div");
    const blockMarker = document.createElement("div");
    blockMarker.className = "vd-block-comment";
    blockMarker.dataset.threadId = "c1";
    blockMarker.dataset.target = "next";
    parent.appendChild(blockMarker);
    const wrapper = document.createElement("div");
    wrapper.className = "vd-block-trigger-wrapper";
    parent.appendChild(wrapper);
    document.body.appendChild(parent);
    const wrapperRef = createRef<HTMLElement>();
    // jsdom: assign to the ref imperatively because we built the DOM by hand.
    Object.assign(wrapperRef, { current: wrapper });
    return { parent, wrapper, wrapperRef };
  };

  it("[bct-existing] clicking the trigger when an existing thread is associated calls onActivate and does not open the form", async () => {
    const view = buildView("```ts\ncode\n```\n");
    const onActivate = vi.fn();
    const { parent, wrapper, wrapperRef } = buildAdjacentDom();
    const { container, queryByText } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
        wrapperRef={wrapperRef}
        onActivate={onActivate}
      />,
      { container: wrapper },
    );
    // The trigger's effect scans on mount and switches to "Open comment".
    const button = await waitFor(() => {
      const b = container.querySelector(".vd-block-trigger");
      expect(b?.textContent).toBe("Open comment");
      return b!;
    });
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith("c1");
    expect(container.querySelector(".vd-block-trigger-popover")).toBeNull();
    expect(queryByText("Comment")).toBeNull();
    document.body.removeChild(parent);
  });

  it("[bct-existing-prev] resolves an adjacent block marker placed *after* the wrapper (target:prev)", async () => {
    const view = buildView("```ts\ncode\n```\n");
    const onActivate = vi.fn();
    const parent = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.className = "vd-block-trigger-wrapper";
    parent.appendChild(wrapper);
    const blockMarker = document.createElement("div");
    blockMarker.className = "vd-block-comment";
    blockMarker.dataset.threadId = "cP";
    blockMarker.dataset.target = "prev";
    parent.appendChild(blockMarker);
    document.body.appendChild(parent);
    const wrapperRef = createRef<HTMLElement>();
    Object.assign(wrapperRef, { current: wrapper });
    const { container } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
        wrapperRef={wrapperRef}
        onActivate={onActivate}
      />,
      { container: wrapper },
    );
    const button = await waitFor(() => {
      const b = container.querySelector(".vd-block-trigger");
      expect(b?.textContent).toBe("Open comment");
      return b!;
    });
    // mousedown is preventDefaulted on the existing-thread variant too, so the
    // caret doesn't jump into the underlying <pre>.
    const md = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith("cP");
    document.body.removeChild(parent);
  });

  it("[bct-label] label differs based on whether an existing thread targets this block", async () => {
    const view = buildView("```ts\ncode\n```\n");
    // Without an existing adjacent block marker the label is "Comment".
    const { container: defaultContainer } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
      />,
    );
    expect(
      defaultContainer.querySelector(".vd-block-trigger")?.textContent,
    ).toBe("Comment");

    // With an adjacent block marker the label flips to "Open comment".
    const { parent, wrapper, wrapperRef } = buildAdjacentDom();
    const { container } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={0}
        currentAuthor="alice"
        wrapperRef={wrapperRef}
        onActivate={vi.fn()}
      />,
      { container: wrapper },
    );
    await waitFor(() => {
      expect(container.querySelector(".vd-block-trigger")?.textContent).toBe(
        "Open comment",
      );
    });
    document.body.removeChild(parent);
  });

  it("[bct-line-resolution] computes blockLine from sourceStart via doc.lineAt", () => {
    // Line 5 starts at offset 12 in the doc below ("a\nb\nc\nd\ne\n").
    const doc = "a\nb\nc\nd\ne\n";
    const view = buildView(doc);
    const sourceStart = doc.indexOf("e");
    const { container, getByText } = render(
      <BlockCommentTrigger
        editorView={view}
        sourceStart={sourceStart}
        currentAuthor="alice"
      />,
    );
    fireEvent.click(getByText("Comment"));
    const ta = container.querySelector("textarea");
    if (ta === null) throw new Error("expected textarea");
    fireEvent.change(ta, { target: { value: "x" } });
    fireEvent.click(getByText("Submit"));
    // Marker must appear before line 5 (the "e") — preceded by lines a..d.
    expect(view.state.doc.toString()).toMatch(
      /a\nb\nc\nd\n\{>>block id:[a-z0-9]+ target:next.*: x<<\}\n\ne\n/,
    );
  });
});
