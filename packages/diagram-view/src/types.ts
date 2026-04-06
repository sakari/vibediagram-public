import type React from "react";

/** 2D coordinate. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Visual shape for a diagram node. */
export type NodeShape =
  | "rectangle"
  | "cylinder"
  | "diamond"
  | "rounded-rectangle"
  | "circle"
  | "hexagon";

/** Visual style for a diagram node or group. Uses CSS property names as the common denominator. */
export interface NodeStyle {
  readonly background?: string;
  readonly borderColor?: string;
  readonly borderWidth?: number;
  readonly opacity?: number;
  readonly boxShadow?: string;
  readonly shape?: NodeShape;
}

/** Visual style for a diagram edge. All fields optional. */
export interface EdgeStyle {
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly animated?: boolean;
  readonly strokeDash?: string;
}

/** A text row inlined from a collapsed node. */
export interface InlineEntry {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted metric value, e.g. "1.2k" or "25ms". */
  readonly value?: string;
}

/** A node in the diagram graph. */
export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  readonly type?: string;
  readonly parentId?: string;
  readonly style?: NodeStyle;
  /** Data attached to the node. className identifies the Blueprint class that created it. */
  readonly data?: { readonly className?: string } & Record<string, unknown>;
  /** Nodes collapsed into this node via display: "inline". */
  readonly inlineChildren?: readonly InlineEntry[];
}

/** An edge connecting two nodes. */
export interface DiagramEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly style?: EdgeStyle;
}

/** A visual group that contains child nodes (identified by DiagramNode.parentId). */
export interface DiagramGroup {
  readonly id: string;
  readonly label: string;
  readonly style?: NodeStyle;
  /** Data attached to the group. className identifies the Blueprint class that created it. */
  readonly data?: { readonly className?: string } & Record<string, unknown>;
  /** If set, this group is nested inside another group. */
  readonly parentId?: string;
}

/**
 * Complete description of a diagram to render.
 * Pure data — no positions, no library-specific types.
 */
export interface DiagramSpec {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly groups: readonly DiagramGroup[];
}

/** Controls how the layout engine arranges the graph. */
export interface LayoutOptions {
  readonly direction?: "DOWN" | "RIGHT" | "UP" | "LEFT";
  readonly nodeSpacing?: number;
  readonly layerSpacing?: number;
  readonly edgeRouting?: "ORTHOGONAL" | "POLYLINE" | "SPLINES";
}

/** Props passed to custom node components registered via nodeTypes. */
export interface DiagramNodeComponentProps {
  readonly id: string;
  readonly label: string;
  readonly data?: Record<string, unknown>;
  readonly style?: NodeStyle;
  readonly selected?: boolean;
}

/**
 * Props accepted by the DiagramRenderer component.
 *
 * nodeTypes maps DiagramNode.type values to React components.
 */
export interface DiagramRendererProps {
  readonly spec: DiagramSpec;
  readonly nodeTypes?: Record<
    string,
    React.ComponentType<DiagramNodeComponentProps>
  >;
  readonly onNodeClick?: (nodeId: string) => void;
  readonly onNodeDrag?: (nodeId: string, position: Point) => void;
  readonly layoutOptions?: LayoutOptions;
  readonly className?: string;
}
