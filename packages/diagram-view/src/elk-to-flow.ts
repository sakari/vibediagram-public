import type { ElkNode, ElkExtendedEdge } from "elkjs";
import { MarkerType, type Node, type Edge } from "@xyflow/react";
import type {
  DiagramSpec,
  NodeStyle,
  EdgeStyle,
  InlineEntry,
  Point,
} from "./types";
import { buildNodeStyle } from "./node-style";

/** The shape of data we attach to React Flow edges for bend-point rendering. */
interface ElkEdgeData {
  bendPoints: Point[];
  [key: string]: unknown;
}

function edgeStyleToCss(
  s: EdgeStyle | undefined,
): Record<string, string | number> | undefined {
  if (!s) return undefined;
  const css: Record<string, string | number> = {};
  if (s.stroke) css.stroke = s.stroke;
  if (s.strokeWidth !== undefined) css.strokeWidth = s.strokeWidth;
  return Object.keys(css).length > 0 ? css : undefined;
}

type SpecNodeEntry = {
  style?: NodeStyle;
  data?: Record<string, unknown>;
  type?: string;
  label: string;
  inlineChildren?: readonly InlineEntry[];
};

type SpecGroupEntry = {
  style?: NodeStyle;
  data?: Record<string, unknown>;
  label: string;
};

function getNodeOptionalFields(
  child: ElkNode,
  specNode: SpecNodeEntry | undefined,
  specGroup: SpecGroupEntry | undefined,
  parentId: string | undefined,
): Partial<Node> {
  const extras: Partial<Node> = {};
  if (parentId) extras.parentId = parentId;
  const type = specGroup !== undefined ? "group" : specNode?.type;
  if (type) extras.type = type;
  // Populate `measured` so React Flow preserves handleBounds across
  // setNodes calls that pass new object references. Without this,
  // parseHandles() returns undefined whenever `measured` is falsy,
  // wiping handleBounds and causing edges to silently disappear until
  // the next ResizeObserver pass restores them. See xyflow/system
  // adoptUserNodes + parseHandles.
  if (child.width !== undefined && child.height !== undefined) {
    extras.measured = { width: child.width, height: child.height };
  }
  return extras;
}

function buildNodeData(
  specNode: SpecNodeEntry | undefined,
  specGroup: SpecGroupEntry | undefined,
  label: string,
  nodeStyle: NodeStyle | undefined,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    label,
    ...(specNode?.data ?? specGroup?.data ?? {}),
  };
  if (nodeStyle) data.nodeStyle = nodeStyle;
  if (specNode?.inlineChildren) data.inlineChildren = specNode.inlineChildren;
  return data;
}

function buildNodeFromElkChild(
  child: ElkNode,
  specNode: SpecNodeEntry | undefined,
  specGroup: SpecGroupEntry | undefined,
  parentId: string | undefined,
): Node {
  const nodeStyle = specNode?.style ?? specGroup?.style;
  const label = specNode?.label ?? specGroup?.label ?? child.id;
  const data = buildNodeData(specNode, specGroup, label, nodeStyle);

  const base: Node = {
    id: child.id,
    position: { x: child.x ?? 0, y: child.y ?? 0 },
    data,
    style: buildNodeStyle(nodeStyle),
  };

  return Object.assign(
    base,
    getNodeOptionalFields(child, specNode, specGroup, parentId),
  );
}

function collectNodes(
  elkNode: ElkNode,
  specNodeMap: Map<string, SpecNodeEntry>,
  specGroupMap: Map<string, SpecGroupEntry>,
  parentId: string | undefined,
): Node[] {
  const result: Node[] = [];
  const children = elkNode.children ?? [];

  for (const child of children) {
    const specNode = specNodeMap.get(child.id);
    const specGroup = specGroupMap.get(child.id);
    result.push(buildNodeFromElkChild(child, specNode, specGroup, parentId));

    if ((child.children?.length ?? 0) > 0) {
      result.push(...collectNodes(child, specNodeMap, specGroupMap, child.id));
    }
  }

  return result;
}

/**
 * Extract bend points from an ELK edge's sections.
 * Returns an ordered array of points: startPoint, bendPoints..., endPoint.
 */
function extractBendPoints(edge: ElkExtendedEdge): Point[] {
  const sections = edge.sections ?? [];
  if (sections.length === 0) return [];

  const points: Point[] = [];
  for (const section of sections) {
    points.push({ x: section.startPoint.x, y: section.startPoint.y });
    for (const bp of section.bendPoints ?? []) {
      points.push({ x: bp.x, y: bp.y });
    }
    points.push({ x: section.endPoint.x, y: section.endPoint.y });
  }
  return points;
}

/**
 * Collect edges from all levels of the ELK graph.
 * With hierarchyHandling=INCLUDE_CHILDREN, ELK may place edges inside
 * compound nodes rather than at the root level.
 */
function collectEdges(elkNode: ElkNode): ElkExtendedEdge[] {
  const result: ElkExtendedEdge[] = [...(elkNode.edges ?? [])];
  for (const child of elkNode.children ?? []) {
    result.push(...collectEdges(child));
  }
  return result;
}

/**
 * Transform a laid-out ELK graph and the original DiagramSpec into
 * React Flow nodes and edges. Merges styles, data, and bend points
 * from their respective sources.
 */
export function elkToFlow(
  elkRoot: ElkNode,
  spec: DiagramSpec,
): { nodes: Node[]; edges: Edge[] } {
  const specNodeMap = new Map(
    spec.nodes.map((n) => [
      n.id,
      {
        style: n.style,
        data: n.data,
        type: n.type,
        label: n.label,
        inlineChildren: n.inlineChildren,
      },
    ]),
  );
  const specGroupMap = new Map(
    spec.groups.map((g) => [
      g.id,
      { style: g.style, data: g.data, label: g.label },
    ]),
  );
  const specEdgeMap = new Map(
    spec.edges.map((e) => [e.id, { style: e.style, label: e.label }]),
  );

  const nodes = collectNodes(elkRoot, specNodeMap, specGroupMap, undefined);

  // Synthetic edges (created in spec-to-elk.ts to force row separation
  // within groups) are layout-only: they reference handles that don't
  // exist on the rendered nodes. Passing them to React Flow logs
  // "Couldn't create edge for source handle id: null" warnings on
  // every render, so strip them before returning.
  const allElkEdges = collectEdges(elkRoot).filter(
    (e) => !e.id.startsWith("__synthetic__"),
  );
  const edges: Edge[] = allElkEdges.map((elkEdge) => {
    const ext = elkEdge;
    const specEdge = specEdgeMap.get(elkEdge.id);
    const bendPoints = extractBendPoints(ext);

    return {
      id: elkEdge.id,
      source: ext.sources[0],
      target: ext.targets[0],
      type: "elk",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      ...(specEdge?.label ? { label: specEdge.label } : {}),
      style: edgeStyleToCss(specEdge?.style),
      data: { bendPoints } satisfies ElkEdgeData,
    };
  });

  return { nodes, edges };
}
