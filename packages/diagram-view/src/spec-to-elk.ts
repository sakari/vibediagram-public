import type {
  ElkNode,
  ElkExtendedEdge,
  LayoutOptions as ElkLayoutOptions,
} from "elkjs";
import type { DiagramSpec, LayoutOptions } from "./types";

const DIRECTION_MAP: Record<string, string> = {
  DOWN: "DOWN",
  RIGHT: "RIGHT",
  UP: "UP",
  LEFT: "LEFT",
};

const EDGE_ROUTING_MAP: Record<string, string> = {
  ORTHOGONAL: "ORTHOGONAL",
  POLYLINE: "POLYLINE",
  SPLINES: "SPLINES",
};

/** Map of node ID to measured DOM dimensions. */
export type NodeSizeMap = Partial<
  Record<string, { width: number; height: number }>
>;

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 40;
const GROUP_PADDING = 30;

/**
 * Convert diagram-level LayoutOptions to an ELK layoutOptions record.
 * Falls back to sensible defaults when fields are omitted.
 */
function toElkLayoutOptions(opts: LayoutOptions | undefined): ElkLayoutOptions {
  const result: ElkLayoutOptions = {
    "elk.algorithm": "layered",
    "elk.direction": DIRECTION_MAP[opts?.direction ?? "DOWN"] ?? "DOWN",
    "elk.spacing.nodeNode": String(opts?.nodeSpacing ?? 40),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(
      opts?.layerSpacing ?? 60,
    ),
    "elk.edgeRouting":
      EDGE_ROUTING_MAP[opts?.edgeRouting ?? "ORTHOGONAL"] ?? "ORTHOGONAL",
  };
  return result;
}

/**
 * Resolve the width/height for a node in the ELK graph.
 * Uses DOM-measured sizes when available (fed back from the measurement cycle).
 * For unmeasured nodes, falls back to the average measured size of other nodes
 * with the same type — this gives a much better initial estimate than the
 * generic default (e.g. MetricNode is ~220×100, not 160×40) and prevents
 * newly spawned nodes from visually overflowing their parent groups during
 * the first layout pass before measurements converge.
 */
function resolveNodeSize(
  nodeId: string,
  _nodeType: string | undefined,
  nodeSizes: NodeSizeMap | undefined,
  typeSizeFallback: Map<string, { width: number; height: number }> | undefined,
): { width: number; height: number } {
  const measured = nodeSizes?.[nodeId];
  if (measured) return measured;
  if (_nodeType && typeSizeFallback) {
    const fallback = typeSizeFallback.get(_nodeType);
    if (fallback) return fallback;
  }
  return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

/**
 * Build a map from node type to average measured size.
 * Used as a fallback for unmeasured nodes of the same type.
 */
function buildTypeSizeFallback(
  spec: DiagramSpec,
  nodeSizes: NodeSizeMap | undefined,
): Map<string, { width: number; height: number }> | undefined {
  if (!nodeSizes) return undefined;
  const acc = new Map<
    string,
    { totalW: number; totalH: number; count: number }
  >();
  for (const node of spec.nodes) {
    const size = nodeSizes[node.id];
    if (!size || !node.type) continue;
    const entry = acc.get(node.type);
    if (entry) {
      entry.totalW += size.width;
      entry.totalH += size.height;
      entry.count++;
    } else {
      acc.set(node.type, { totalW: size.width, totalH: size.height, count: 1 });
    }
  }
  const result = new Map<string, { width: number; height: number }>();
  for (const [type, entry] of acc) {
    result.set(type, {
      width: Math.round(entry.totalW / entry.count),
      height: Math.round(entry.totalH / entry.count),
    });
  }
  return result.size > 0 ? result : undefined;
}

/**
 * Build a set of node IDs that are targets of at least one edge.
 */
function buildEdgeTargetSet(spec: DiagramSpec): Set<string> {
  const targets = new Set<string>();
  for (const edge of spec.edges) {
    targets.add(edge.target);
  }
  return targets;
}

/**
 * Build a map from node ID to its DiagramNode type for grouped nodes.
 */
function buildNodeTypeMap(spec: DiagramSpec): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const node of spec.nodes) {
    if (node.parentId) {
      map.set(node.id, node.type);
    }
  }
  return map;
}

/** Row ordering: types listed first get placed in earlier layers. */
const ROW_ORDER: readonly string[] = ["metric", "simInput"];

/**
 * Generate synthetic ELK edges within a group to force row separation.
 *
 * For edgeless children (no inbound edges), splits them by node type and
 * adds edges from an anchor in each earlier type-group to every node in
 * the next type-group. This makes ELK's layered algorithm place different
 * types in separate layers.
 */
function buildSyntheticEdges(
  groupId: string,
  children: ElkNode[],
  edgeTargets: Set<string>,
  nodeTypeMap: Map<string, string | undefined>,
): ElkExtendedEdge[] {
  // Collect edgeless children grouped by row-order bucket
  const buckets = new Map<string, string[]>();
  for (const child of children) {
    if (edgeTargets.has(child.id)) continue;
    const nodeType = nodeTypeMap.get(child.id);
    if (!nodeType) continue;
    const bucket = buckets.get(nodeType);
    if (bucket) bucket.push(child.id);
    else buckets.set(nodeType, [child.id]);
  }

  // Sort buckets by ROW_ORDER; types not in ROW_ORDER are skipped
  const orderedBuckets: string[][] = [];
  for (const type of ROW_ORDER) {
    const ids = buckets.get(type);
    if (ids && ids.length > 0) orderedBuckets.push(ids);
  }

  if (orderedBuckets.length < 2) return [];

  // Chain adjacent buckets: last node of bucket[i] → each node of bucket[i+1]
  const syntheticEdges: ElkExtendedEdge[] = [];
  for (let i = 0; i < orderedBuckets.length - 1; i++) {
    const anchor = orderedBuckets[i][orderedBuckets[i].length - 1];
    for (const targetId of orderedBuckets[i + 1]) {
      syntheticEdges.push({
        id: `__synthetic__${groupId}__${anchor}__${targetId}`,
        sources: [anchor],
        targets: [targetId],
      });
    }
  }
  return syntheticEdges;
}

/**
 * Transform a library-agnostic DiagramSpec into an ELK graph
 * ready for layout computation. Groups become compound ELK nodes
 * whose children are the diagram nodes that reference them via parentId.
 *
 * Edgeless children within groups are automatically arranged into rows
 * by node type (metrics first, then inputs) via synthetic edges.
 *
 * Returns an ElkNode representing the root of the graph. The caller
 * should pass it to `elk.layout()`.
 */
export function specToElk(
  spec: DiagramSpec,
  opts?: LayoutOptions,
  nodeSizes?: NodeSizeMap,
): ElkNode {
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const hasCompound = spec.nodes.some(
    (n) => n.parentId && groupIds.has(n.parentId),
  );

  const layoutOptions = toElkLayoutOptions(opts);
  if (hasCompound) {
    layoutOptions["elk.hierarchyHandling"] = "INCLUDE_CHILDREN";
  }

  const groupChildrenMap = new Map<string, ElkNode[]>();
  for (const g of spec.groups) {
    groupChildrenMap.set(g.id, []);
  }

  const typeSizeFallback = buildTypeSizeFallback(spec, nodeSizes);

  const rootChildren: ElkNode[] = [];

  for (const node of spec.nodes) {
    const size = resolveNodeSize(
      node.id,
      node.type,
      nodeSizes,
      typeSizeFallback,
    );
    const elkChild: ElkNode = {
      id: node.id,
      ...size,
      layoutOptions: {
        "org.eclipse.elk.portConstraints": "FIXED_SIDE",
      },
    };

    const parentChildren = node.parentId
      ? groupChildrenMap.get(node.parentId)
      : undefined;
    if (parentChildren) {
      parentChildren.push(elkChild);
    } else {
      rootChildren.push(elkChild);
    }
  }

  const edgeTargets = buildEdgeTargetSet(spec);
  const nodeTypeMap = buildNodeTypeMap(spec);

  for (const group of spec.groups) {
    const children = groupChildrenMap.get(group.id) ?? [];
    const syntheticEdges = buildSyntheticEdges(
      group.id,
      children,
      edgeTargets,
      nodeTypeMap,
    );

    const compoundNode: ElkNode = {
      id: group.id,
      layoutOptions: {
        "elk.padding": `[top=${String(GROUP_PADDING)},left=${String(GROUP_PADDING)},bottom=${String(GROUP_PADDING)},right=${String(GROUP_PADDING)}]`,
      },
      children,
      ...(syntheticEdges.length > 0 ? { edges: syntheticEdges } : {}),
    };
    // Nested group: place inside parent group's children
    const parentChildren = group.parentId
      ? groupChildrenMap.get(group.parentId)
      : undefined;
    if (parentChildren) {
      parentChildren.push(compoundNode);
    } else {
      rootChildren.push(compoundNode);
    }
  }

  const edges: ElkExtendedEdge[] = spec.edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  return {
    id: "root",
    layoutOptions,
    children: rootChildren,
    edges,
  };
}
