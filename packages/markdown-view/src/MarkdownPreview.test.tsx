/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

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
});
