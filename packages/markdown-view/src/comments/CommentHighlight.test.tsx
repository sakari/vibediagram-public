/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { CommentHighlight } from "./CommentHighlight";

afterEach(() => {
  cleanup();
});

describe("CommentHighlight", () => {
  it("[ch-render] renders a mark with thread-id and resolved attributes", () => {
    const { container } = render(
      <CommentHighlight
        threadId="abc"
        resolved={false}
        onActivate={() => undefined}
      >
        word
      </CommentHighlight>,
    );
    const mark = container.querySelector("mark");
    expect(mark?.getAttribute("data-thread-id")).toBe("abc");
    expect(mark?.getAttribute("data-resolved")).toBe("false");
    expect(mark?.textContent).toBe("word");
  });

  it("[ch-click] invokes onActivate with the thread id when clicked", () => {
    let id = "";
    const { container } = render(
      <CommentHighlight
        threadId="xyz"
        resolved={true}
        onActivate={(i) => (id = i)}
      >
        text
      </CommentHighlight>,
    );
    fireEvent.click(container.querySelector("mark")!);
    expect(id).toBe("xyz");
  });

  it("[ch-resolved] applies the resolved class when resolved", () => {
    const { container } = render(
      <CommentHighlight
        threadId="abc"
        resolved={true}
        onActivate={() => undefined}
      >
        x
      </CommentHighlight>,
    );
    expect(
      container.querySelector(".vd-comment-anchor--resolved"),
    ).not.toBeNull();
  });
});
