/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import type { Root as HastRoot, Element, Text, RootContent } from "hast";
import { rehypeCriticmarkup } from "./rehype-criticmarkup";
import { preprocessCriticMarkup, type MarkerInfo } from "./preprocess";

const PUA_OPEN = "";
const PUA_CLOSE = "";
const placeholder = (kind: "H" | "B", id: string): string =>
  `${PUA_OPEN}${kind}${id}${PUA_CLOSE}`;

const isHastRoot = (node: unknown): node is HastRoot => {
  if (typeof node !== "object" || node === null) return false;
  const candidate = node as { type?: unknown };
  return candidate.type === "root";
};

const expectRoot = (node: unknown): HastRoot => {
  if (!isHastRoot(node)) {
    throw new Error("expected hast root from unified pipeline");
  }
  return node;
};

const applyPlugin = (
  markers: ReadonlyMap<string, MarkerInfo>,
  tree: HastRoot,
): HastRoot =>
  expectRoot(unified().use(rehypeCriticmarkup(markers)).runSync(tree));

const buildHast = (
  markdown: string,
): {
  tree: HastRoot;
  markers: ReturnType<typeof preprocessCriticMarkup>["markers"];
} => {
  const { source, markers } = preprocessCriticMarkup(markdown);
  const mdast = unified().use(remarkParse).use(remarkGfm).parse(source);
  const initial = expectRoot(unified().use(remarkRehype).runSync(mdast));
  const tree = applyPlugin(markers, initial);
  return { tree, markers };
};

const findElement = (
  node: HastRoot | Element | Text | RootContent,
  predicate: (el: Element) => boolean,
): Element | null => {
  if (node.type === "element" && predicate(node)) return node;
  if (node.type === "element" || node.type === "root") {
    for (const c of node.children) {
      const found = findElement(c, predicate);
      if (found !== null) return found;
    }
  }
  return null;
};

const dummyInlineInfo: MarkerInfo = {
  kind: "inline",
  thread: { id: "z", resolved: false, messages: [] },
  exact: "x",
};

describe("rehypeCriticmarkup", () => {
  it("does nothing when there are no markers", () => {
    const { tree, markers } = buildHast("plain markdown");
    expect(markers.size).toBe(0);
    const p = findElement(tree, (el) => el.tagName === "p");
    expect(p).not.toBeNull();
  });

  it("transforms an inline highlight placeholder into a <mark>", () => {
    const { tree } = buildHast("Hi {==there==}{>>id:c1<<} friend");
    const mark = findElement(tree, (el) => el.tagName === "mark");
    expect(mark).not.toBeNull();
    expect(mark?.properties["data-thread-id"]).toBe("c1");
    expect(mark?.properties.className).toEqual(["vd-comment-anchor"]);
  });

  it("transforms a standalone block placeholder into a <div> at the root", () => {
    const md =
      "Before\n\n{>>block id:b1 target:next | by:@a 2026: hi<<}\n\nAfter";
    const { tree } = buildHast(md);
    const div = findElement(
      tree,
      (el) => el.tagName === "div" && el.properties["data-thread-id"] === "b1",
    );
    expect(div).not.toBeNull();
    expect(div?.properties["data-target"]).toBe("next");
  });

  it("recurses into nested elements (e.g. headings)", () => {
    const { tree } = buildHast("# Title {==x==}{>>id:c1<<} end");
    const h1 = findElement(tree, (el) => el.tagName === "h1");
    expect(h1).not.toBeNull();
    const mark = findElement(tree, (el) => el.tagName === "mark");
    expect(mark).not.toBeNull();
  });

  it("collapses an inline-context block placeholder to an inline element", () => {
    // Block placeholder mixed with prose is matched by the source preprocessor
    // but cannot legally unwrap into a <div> inside a <p>; the plugin keeps
    // the paragraph and emits the block element inline. (Unusual case — block
    // markers in real use sit on their own paragraph.)
    const md =
      "Look here {>>block id:b1 target:next | by:@a 2026: hi<<} please";
    const { tree, markers } = buildHast(md);
    expect(markers.size).toBe(1);
    const p = findElement(tree, (el) => el.tagName === "p");
    expect(p).not.toBeNull();
    const div = findElement(
      tree,
      (el) => el.tagName === "div" && el.properties["data-thread-id"] === "b1",
    );
    expect(div).not.toBeNull();
  });

  it("leaves an unknown placeholder as literal text", () => {
    const tree: HastRoot = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            {
              type: "text",
              value: `before ${placeholder("H", "UNKNOWN")} after`,
            },
          ],
        },
      ],
    };
    const markers = new Map<string, MarkerInfo>([["dummy", dummyInlineInfo]]);
    applyPlugin(markers, tree);
    expect(findElement(tree, (el) => el.tagName === "mark")).toBeNull();
  });

  it("does not unwrap a paragraph that has more than one child", () => {
    const tree: HastRoot = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            { type: "text", value: placeholder("B", "X") },
            { type: "text", value: " trailing" },
          ],
        },
      ],
    };
    const markers = new Map<string, MarkerInfo>([["dummy", dummyInlineInfo]]);
    applyPlugin(markers, tree);
    const p = findElement(tree, (el) => el.tagName === "p");
    expect(p).not.toBeNull();
  });

  it("does not unwrap a paragraph whose only child is not a text node", () => {
    const tree: HastRoot = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "em",
              properties: {},
              children: [{ type: "text", value: "x" }],
            },
          ],
        },
      ],
    };
    const markers = new Map<string, MarkerInfo>([["dummy", dummyInlineInfo]]);
    applyPlugin(markers, tree);
    const p = findElement(tree, (el) => el.tagName === "p");
    expect(p).not.toBeNull();
  });

  it("does not unwrap a paragraph whose placeholder maps to an inline marker", () => {
    const tree: HastRoot = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: placeholder("H", "X") }],
        },
      ],
    };
    const markers = new Map<string, MarkerInfo>([
      [
        "X",
        {
          kind: "inline",
          thread: { id: "i1", resolved: false, messages: [] },
          exact: "x",
        },
      ],
    ]);
    applyPlugin(markers, tree);
    const p = findElement(tree, (el) => el.tagName === "p");
    expect(p).not.toBeNull();
    expect(findElement(tree, (el) => el.tagName === "mark")).not.toBeNull();
  });
});
