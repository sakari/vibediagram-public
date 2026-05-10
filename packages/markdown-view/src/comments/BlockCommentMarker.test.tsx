/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BlockCommentMarker } from "./BlockCommentMarker";

afterEach(() => {
  cleanup();
});

describe("BlockCommentMarker", () => {
  it("[bcm-render] renders a hidden div carrying thread metadata", () => {
    const { container } = render(
      <BlockCommentMarker threadId="bk" target="next" resolved={false} />,
    );
    const div = container.querySelector(".vd-block-comment");
    expect(div?.getAttribute("data-thread-id")).toBe("bk");
    expect(div?.getAttribute("data-target")).toBe("next");
    expect(div?.getAttribute("data-resolved")).toBe("false");
  });

  it("[bcm-resolved] reflects resolved=true in the data attribute", () => {
    const { container } = render(
      <BlockCommentMarker threadId="bk2" target="prev" resolved={true} />,
    );
    expect(
      container
        .querySelector(".vd-block-comment")
        ?.getAttribute("data-resolved"),
    ).toBe("true");
  });
});
