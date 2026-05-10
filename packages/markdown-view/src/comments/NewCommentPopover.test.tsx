/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { NewCommentPopover } from "./NewCommentPopover";

afterEach(() => {
  cleanup();
});

const buildView = (doc: string): EditorView =>
  new EditorView({ state: EditorState.create({ doc }) });

describe("NewCommentPopover", () => {
  it("[ncp-trigger] starts in trigger state", () => {
    const view = buildView("hello world");
    const { container } = render(
      <NewCommentPopover
        editorView={view}
        selection={{ sourceStart: 0, sourceEnd: 5, text: "hello" }}
        currentAuthor="alice"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".vd-new-comment-trigger")).not.toBeNull();
  });

  it("[ncp-open] clicking the trigger reveals the form", () => {
    const view = buildView("hello world");
    const { container, getByText } = render(
      <NewCommentPopover
        editorView={view}
        selection={{ sourceStart: 0, sourceEnd: 5, text: "hello" }}
        currentAuthor="alice"
        onClose={() => undefined}
      />,
    );
    fireEvent.click(getByText("Comment"));
    expect(container.querySelector(".vd-new-comment-popover")).not.toBeNull();
  });

  it("[ncp-submit] submitting inserts critic markup and closes", () => {
    const view = buildView("hello world");
    let closed = 0;
    const { container, getByText } = render(
      <NewCommentPopover
        editorView={view}
        selection={{ sourceStart: 0, sourceEnd: 5, text: "hello" }}
        currentAuthor="alice"
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    fireEvent.click(getByText("Comment"));
    const ta = container.querySelector("textarea")!;
    fireEvent.change(ta, { target: { value: "needs work" } });
    fireEvent.click(getByText("Submit"));
    expect(view.state.doc.toString()).toContain("{==hello==}{>>id:");
    expect(view.state.doc.toString()).toContain(": needs work");
    expect(closed).toBe(1);
  });

  it("[ncp-cancel] cancel button closes the popover", () => {
    const view = buildView("hello");
    let closed = 0;
    const { getByText } = render(
      <NewCommentPopover
        editorView={view}
        selection={{ sourceStart: 0, sourceEnd: 5, text: "hello" }}
        currentAuthor="alice"
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    fireEvent.click(getByText("Comment"));
    fireEvent.click(getByText("Cancel"));
    expect(closed).toBe(1);
  });

  it("[ncp-empty] does not insert when draft is empty", () => {
    const view = buildView("hello world");
    const { getByText, container } = render(
      <NewCommentPopover
        editorView={view}
        selection={{ sourceStart: 0, sourceEnd: 5, text: "hello" }}
        currentAuthor="alice"
        onClose={() => undefined}
      />,
    );
    fireEvent.click(getByText("Comment"));
    // submit without typing
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    expect(view.state.doc.toString()).toBe("hello world");
  });

  it("[ncp-null-selection] renders nothing when no selection and not drafting", () => {
    const view = buildView("hello world");
    const { container } = render(
      <NewCommentPopover
        editorView={view}
        selection={null}
        currentAuthor="alice"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".vd-new-comment-trigger")).toBeNull();
    expect(container.querySelector(".vd-new-comment-popover")).toBeNull();
  });

  it("[ncp-snapshot] survives selection going null mid-draft and inserts at the captured range", () => {
    const view = buildView("hello world");
    const initial = {
      sourceStart: 0,
      sourceEnd: 5,
      text: "hello",
    };
    const { container, getByText, rerender } = render(
      <NewCommentPopover
        editorView={view}
        selection={initial}
        currentAuthor="alice"
        onClose={() => undefined}
      />,
    );
    fireEvent.click(getByText("Comment"));
    // The browser would clear the live selection right after the click. Make
    // sure the popover doesn't lose its captured range.
    rerender(
      <NewCommentPopover
        editorView={view}
        selection={null}
        currentAuthor="alice"
        onClose={() => undefined}
      />,
    );
    expect(container.querySelector(".vd-new-comment-popover")).not.toBeNull();
    const ta = container.querySelector("textarea")!;
    fireEvent.change(ta, { target: { value: "still works" } });
    fireEvent.click(getByText("Submit"));
    expect(view.state.doc.toString()).toContain("{==hello==}");
    expect(view.state.doc.toString()).toContain(": still works");
  });

  it("[ncp-mousedown] trigger preventDefaults mousedown", () => {
    const view = buildView("hello world");
    const { container, getByText } = render(
      <NewCommentPopover
        editorView={view}
        selection={{ sourceStart: 0, sourceEnd: 5, text: "hello" }}
        currentAuthor="alice"
        onClose={() => undefined}
      />,
    );
    void container;
    const trigger = getByText("Comment");
    const evt = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    trigger.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});
