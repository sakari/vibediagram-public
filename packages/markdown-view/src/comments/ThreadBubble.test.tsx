/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ThreadBubble } from "./ThreadBubble";
import type { ThreadMarker } from "./types";

const marker = (resolved = false): ThreadMarker => {
  const anchor = document.createElement("mark");
  return {
    id: "abc",
    kind: "inline",
    thread: {
      id: "abc",
      resolved,
      messages: [{ author: "alice", ts: "2026-01-01T00:00Z", text: "first" }],
    },
    anchorEl: anchor,
  };
};

describe("ThreadBubble", () => {
  it("[tb-collapsed] renders a button with the message count when collapsed", () => {
    const { container } = render(
      <ThreadBubble
        marker={marker()}
        currentAuthor="bob"
        expanded={false}
        onToggle={() => undefined}
        top={0}
      />,
    );
    const btn = container.querySelector(".vd-comment-bubble--collapsed");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("1");
  });

  it("[tb-expanded-readonly] expanded read-only state hides reply UI", () => {
    const { container } = render(
      <ThreadBubble
        marker={marker()}
        currentAuthor="bob"
        expanded={true}
        onToggle={() => undefined}
        top={10}
      />,
    );
    expect(
      container.querySelector(".vd-comment-bubble--expanded"),
    ).not.toBeNull();
    expect(container.querySelector(".vd-comment-bubble-reply")).toBeNull();
    expect(
      container.querySelector(".vd-comment-message-author")?.textContent,
    ).toBe("@alice");
  });

  it("[tb-expanded-write] reply form appears when editorView present", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "x {==y==}{>>id:abc | by:@alice 2026-01-01T00:00Z: first<<}",
      }),
    });
    const { container, getByText } = render(
      <ThreadBubble
        marker={marker()}
        editorView={view}
        currentAuthor="bob"
        expanded={true}
        onToggle={() => undefined}
        top={0}
      />,
    );
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, { target: { value: "thanks" } });
    fireEvent.click(getByText("Reply"));
    expect(view.state.doc.toString()).toContain(": thanks");
  });

  it("[tb-resolve] clicking Resolve flips the resolved flag in the source", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "x {==y==}{>>id:abc | by:@alice 2026-01-01T00:00Z: first<<}",
      }),
    });
    const { getByText } = render(
      <ThreadBubble
        marker={marker()}
        editorView={view}
        currentAuthor="bob"
        expanded={true}
        onToggle={() => undefined}
        top={0}
      />,
    );
    fireEvent.click(getByText("Resolve"));
    expect(view.state.doc.toString()).toContain("resolved:true");
  });

  it("[tb-toggle] clicking the close button calls onToggle", () => {
    let called = 0;
    const { getByLabelText } = render(
      <ThreadBubble
        marker={marker()}
        currentAuthor="bob"
        expanded={true}
        onToggle={() => {
          called += 1;
        }}
        top={0}
      />,
    );
    fireEvent.click(getByLabelText("Collapse thread"));
    expect(called).toBe(1);
  });

  it("[tb-collapsed-toggle] clicking the collapsed bubble calls onToggle", () => {
    let called = 0;
    const { getByLabelText } = render(
      <ThreadBubble
        marker={marker()}
        currentAuthor="bob"
        expanded={false}
        onToggle={() => {
          called += 1;
        }}
        top={0}
      />,
    );
    fireEvent.click(getByLabelText("Open thread abc"));
    expect(called).toBe(1);
  });

  it("[tb-reopen] resolved thread shows a Reopen button when editorView present", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "x {==y==}{>>id:abc resolved:true | by:@a 2026: hi<<}",
      }),
    });
    const { getByText } = render(
      <ThreadBubble
        marker={marker(true)}
        editorView={view}
        currentAuthor="bob"
        expanded={true}
        onToggle={() => undefined}
        top={0}
      />,
    );
    fireEvent.click(getByText("Reopen"));
    expect(view.state.doc.toString()).not.toContain("resolved:true");
  });

  it("[tb-empty-reply] empty reply is a no-op", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "x {==y==}{>>id:abc | by:@a 2026: hi<<}",
      }),
    });
    const before = view.state.doc.toString();
    const { container } = render(
      <ThreadBubble
        marker={marker()}
        editorView={view}
        currentAuthor="bob"
        expanded={true}
        onToggle={() => undefined}
        top={0}
      />,
    );
    fireEvent.submit(container.querySelector("form")!);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("[tb-multiline-text] message text containing a newline renders preserving the newline", () => {
    const anchor = document.createElement("mark");
    const m: ThreadMarker = {
      id: "ml",
      kind: "inline",
      thread: {
        id: "ml",
        resolved: false,
        messages: [
          { author: "alice", ts: "2026-01-01", text: "line one\nline two" },
        ],
      },
      anchorEl: anchor,
    };
    const { container } = render(
      <ThreadBubble
        marker={m}
        currentAuthor="bob"
        expanded={true}
        onToggle={() => undefined}
        top={0}
      />,
    );
    const text = container.querySelector(".vd-comment-message-text");
    expect(text).not.toBeNull();
    // The DOM text node must preserve the literal newline so `white-space:
    // pre-wrap` from the stylesheet renders it as two visible lines.
    expect(text!.textContent).toBe("line one\nline two");
  });

  it("[tb-resolved] resolved thread renders with the resolved class", () => {
    const { container } = render(
      <ThreadBubble
        marker={marker(true)}
        currentAuthor="bob"
        expanded={false}
        onToggle={() => undefined}
        top={0}
      />,
    );
    expect(
      container.querySelector(".vd-comment-bubble--resolved"),
    ).not.toBeNull();
  });
});
