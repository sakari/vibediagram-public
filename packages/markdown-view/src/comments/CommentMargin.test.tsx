/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { useRef } from "react";
import { render, cleanup } from "@testing-library/react";
import { CommentMargin } from "./CommentMargin";
import type { ThreadMarker } from "./types";

afterEach(() => {
  cleanup();
});

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { ResizeObserver: StubResizeObserver });
});

const Harness = ({ markers }: { markers: ThreadMarker[] }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} style={{ position: "relative", height: 200, width: 400 }}>
      <CommentMargin
        containerRef={ref}
        markers={markers}
        currentAuthor="bob"
        activeThreadId={null}
        onToggle={() => {
          /* no-op */
        }}
      />
    </div>
  );
};

const buildMarker = (id: string): ThreadMarker => {
  const anchor = document.createElement("mark");
  document.body.appendChild(anchor);
  return {
    id,
    kind: "inline",
    thread: {
      id,
      resolved: false,
      messages: [{ author: "alice", ts: "2026", text: "hi" }],
    },
    anchorEl: anchor,
  };
};

describe("CommentMargin", () => {
  it("[cm-empty] renders no bubbles when there are no markers", () => {
    const { container } = render(<Harness markers={[]} />);
    expect(container.querySelectorAll(".vd-comment-bubble")).toHaveLength(0);
  });

  it("[cm-render] renders one bubble per marker", () => {
    const { container } = render(
      <Harness markers={[buildMarker("a"), buildMarker("b")]} />,
    );
    expect(container.querySelectorAll(".vd-comment-bubble")).toHaveLength(2);
  });

  it("[cm-toggle] forwards click to onToggle with the marker id", () => {
    const seen: string[] = [];
    const ToggleHarness = () => {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <div ref={ref}>
          <CommentMargin
            containerRef={ref}
            markers={[buildMarker("toggleme")]}
            currentAuthor="bob"
            activeThreadId={null}
            onToggle={(id) => {
              seen.push(id);
            }}
          />
        </div>
      );
    };
    const { container } = render(<ToggleHarness />);
    const btn = container.querySelector(".vd-comment-bubble--collapsed");
    if (!(btn instanceof HTMLButtonElement)) throw new Error("button missing");
    btn.click();
    expect(seen).toEqual(["toggleme"]);
  });
});
