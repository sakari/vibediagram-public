export type {
  Point,
  NodeShape,
  NodeStyle,
  EdgeStyle,
  InlineEntry,
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
  DiagramSpec,
  LayoutOptions,
  DiagramRendererProps,
  DiagramNodeComponentProps,
} from "./types";

// Re-exported so consumers can satisfy `renderOverlay`'s parameter type
// without taking a direct dependency on `@diagram/draw-overlay`. The type
// is the same nominal type — declared once in the leaf package — so
// passing a `CoordTransform` from the overlay package to a consumer of
// this package's `renderOverlay` requires no conversion.
export type { CoordTransform } from "@diagram/draw-overlay";

export { DiagramRenderer } from "./DiagramRenderer";
export { InputNode } from "./InputNode";
export { Handle, Position } from "@xyflow/react";
export { useAutoLayout } from "./useAutoLayout";
export type { AutoLayoutResult } from "./useAutoLayout";
export type { NodeSizeMap } from "./spec-to-elk";
