/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import type { Root } from "hast";
import { rehypeSourcePosition } from "./rehype-source-position";

const buildTree = (): Root => ({
  type: "root",
  children: [
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value: "hi" }],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 3, offset: 2 },
      },
    },
  ],
});

describe("rehypeSourcePosition", () => {
  it("[rsp-default] uses the identity mapper when no options are supplied", () => {
    const tree = buildTree();
    const transform = rehypeSourcePosition();
    transform(tree);
    const child = tree.children[0];
    if (child.type !== "element") throw new Error("expected element");
    expect(child.properties["data-source-start"]).toBe("0");
    expect(child.properties["data-source-end"]).toBe("2");
  });

  it("[rsp-mapped] applies the mapOffset callback before writing attributes", () => {
    const tree = buildTree();
    const transform = rehypeSourcePosition({
      mapOffset: (offset) => offset + 100,
    });
    transform(tree);
    const child = tree.children[0];
    if (child.type !== "element") throw new Error("expected element");
    expect(child.properties["data-source-start"]).toBe("100");
    expect(child.properties["data-source-end"]).toBe("102");
  });
});
