/**
 * Rehype plugin that propagates mdast source positions onto rendered hast
 * elements as `data-source-start` / `data-source-end` attributes.
 *
 * Selection-to-source-offset mapping in the preview pane relies on these
 * attributes: the selection hook walks up from the DOM range's start container
 * to the nearest `[data-source-start]` ancestor and counts characters within
 * that block to derive an absolute source offset.
 *
 * The optional `mapOffset` callback is applied to every offset before it is
 * written to the DOM. The CriticMarkup pipeline uses this hook to translate
 * processed-source offsets (the parser's view) back into original-source
 * offsets (what CodeMirror dispatches against).
 */

import type { Root, Element, RootContent } from "hast";

const isElement = (node: RootContent): node is Element =>
  node.type === "element";

const annotate = (
  node: Root | Element,
  mapOffset: (offset: number) => number,
): void => {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    const position = child.position;
    if (
      position !== undefined &&
      position.start.offset !== undefined &&
      position.end.offset !== undefined
    ) {
      child.properties = {
        ...child.properties,
        "data-source-start": String(mapOffset(position.start.offset)),
        "data-source-end": String(mapOffset(position.end.offset)),
      };
    }
    annotate(child, mapOffset);
  }
};

/** @public */
export type RehypeSourcePositionTransformer = (tree: Root) => void;

/** @public */
export type RehypeSourcePositionOptions = {
  /**
   * Optional offset translator. Defaults to identity. When `preprocessCriticMarkup`
   * has rewritten the source, callers should pass a mapper that converts
   * processed-source offsets back to original-source offsets.
   */
  readonly mapOffset?: (offset: number) => number;
};

/** @public */
export const rehypeSourcePosition = (
  options: RehypeSourcePositionOptions = {},
): RehypeSourcePositionTransformer => {
  const mapOffset = options.mapOffset ?? ((offset: number) => offset);
  return (tree: Root): void => {
    annotate(tree, mapOffset);
  };
};
