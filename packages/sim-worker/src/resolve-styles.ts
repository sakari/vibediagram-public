/**
 * Pure functions for resolving declarative StyleRuleDescriptors against
 * a DiagramSpec's topology. Extracted from the worker for testability.
 */

import type {
  DiagramSpec,
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
  InlineEntry,
  NodeStyle,
} from "@diagram/diagram-view";
import type {
  StyleRuleDescriptor,
  StyleDescriptor,
  DisplayMode,
  NumericCondition,
  TopologyCondition,
  MatchCondition,
  MatchPredicate,
  StyleFunction,
  TopoEntry,
  NodeContext,
  GraphContext,
} from "@diagram/sim-model";

// ---------------------------------------------------------------------------
// Metrics index — maps node id → metric name → value
// ---------------------------------------------------------------------------

export type MetricsIndex = Map<string, Map<string, number>>;

// Re-export TopoEntry for backwards compatibility (now defined in sim-model)
export type { TopoEntry } from "@diagram/sim-model";

export function buildTopologyIndex(spec: DiagramSpec): Map<string, TopoEntry> {
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const childParentIds = new Set(
    spec.nodes
      .map((n) => n.parentId)
      .filter((pid): pid is string => pid !== undefined),
  );

  interface Acc {
    inDegree: number;
    outDegree: number;
    hasParent: boolean;
  }

  const acc = new Map<string, Acc>();

  function ensureAcc(id: string, hasParent: boolean): Acc {
    let entry = acc.get(id);
    if (!entry) {
      entry = { inDegree: 0, outDegree: 0, hasParent };
      acc.set(id, entry);
    }
    return entry;
  }

  for (const node of spec.nodes) {
    ensureAcc(node.id, node.parentId !== undefined);
  }
  for (const group of spec.groups) {
    ensureAcc(group.id, group.parentId !== undefined);
  }

  for (const edge of spec.edges) {
    const src = acc.get(edge.source);
    const tgt = acc.get(edge.target);
    if (src) src.outDegree += 1;
    if (tgt) tgt.inDegree += 1;
  }

  const result = new Map<string, TopoEntry>();
  for (const [id, entry] of acc) {
    result.set(id, {
      inDegree: entry.inDegree,
      outDegree: entry.outDegree,
      hasParent: entry.hasParent,
      isGroup: groupIds.has(id) || childParentIds.has(id),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

export function matchNumericCond(
  value: number,
  cond: NumericCondition,
): boolean {
  if (cond.gt !== undefined && value <= cond.gt) return false;
  if (cond.gte !== undefined && value < cond.gte) return false;
  if (cond.lt !== undefined && value >= cond.lt) return false;
  if (cond.lte !== undefined && value > cond.lte) return false;
  if (cond.eq !== undefined && value !== cond.eq) return false;
  return true;
}

export function isNumericCond(v: unknown): v is NumericCondition {
  if (typeof v !== "object" || v === null) return false;
  const keys = Object.keys(v);
  return (
    keys.length > 0 &&
    keys.every((k) => ["gt", "gte", "lt", "lte", "eq"].includes(k))
  );
}

export function matchTopologyCond(
  topo: TopoEntry,
  cond: TopologyCondition,
): boolean {
  if (cond.inDegree !== undefined) {
    if (typeof cond.inDegree === "number") {
      if (topo.inDegree !== cond.inDegree) return false;
    } else if (!matchNumericCond(topo.inDegree, cond.inDegree)) return false;
  }
  if (cond.outDegree !== undefined) {
    if (typeof cond.outDegree === "number") {
      if (topo.outDegree !== cond.outDegree) return false;
    } else if (!matchNumericCond(topo.outDegree, cond.outDegree)) return false;
  }
  if (cond.isGroup !== undefined && topo.isGroup !== cond.isGroup) return false;
  if (cond.hasParent !== undefined && topo.hasParent !== cond.hasParent)
    return false;
  return true;
}

// ---------------------------------------------------------------------------
// NodeContext / GraphContext concrete implementations
// ---------------------------------------------------------------------------

class NodeContextImpl implements NodeContext {
  constructor(
    readonly id: string,
    readonly type: string,
    readonly data: Record<string, unknown>,
    readonly topology: TopoEntry,
    private readonly metricsIndex: MetricsIndex,
  ) {}

  metric(name: string): number | undefined {
    return this.metricsIndex.get(this.id)?.get(name);
  }
}

class GraphContextImpl implements GraphContext {
  private readonly nodeMap: Map<string, NodeContext>;
  private readonly reverseEdgeIndex: Map<string, string[]>;
  private readonly forwardEdgeIndex: Map<string, string[]>;
  private readonly rankCache = new Map<string, Map<string, number>>();

  constructor(
    nodes: NodeContext[],
    edges: readonly { source: string; target: string }[],
  ) {
    this.nodeMap = new Map(nodes.map((n) => [n.id, n]));

    this.reverseEdgeIndex = new Map();
    this.forwardEdgeIndex = new Map();
    for (const edge of edges) {
      const rev = this.reverseEdgeIndex.get(edge.target);
      if (rev) rev.push(edge.source);
      else this.reverseEdgeIndex.set(edge.target, [edge.source]);

      const fwd = this.forwardEdgeIndex.get(edge.source);
      if (fwd) fwd.push(edge.target);
      else this.forwardEdgeIndex.set(edge.source, [edge.target]);
    }
  }

  private lookupNodes(
    index: Map<string, string[]>,
    nodeId: string,
  ): NodeContext[] {
    const ids = index.get(nodeId);
    if (!ids) return [];
    return ids
      .map((id) => this.nodeMap.get(id))
      .filter((n): n is NodeContext => n !== undefined);
  }

  referrers(node: NodeContext): NodeContext[] {
    return this.lookupNodes(this.reverseEdgeIndex, node.id);
  }

  targets(node: NodeContext): NodeContext[] {
    return this.lookupNodes(this.forwardEdgeIndex, node.id);
  }

  rank(node: NodeContext, metricName: string): number {
    let ranks = this.rankCache.get(metricName);
    if (!ranks) {
      ranks = new Map<string, number>();
      const entries: { id: string; value: number }[] = [];
      for (const n of this.nodeMap.values()) {
        const v = n.metric(metricName);
        if (v !== undefined) entries.push({ id: n.id, value: v });
      }
      entries.sort((a, b) => b.value - a.value);
      for (let i = 0; i < entries.length; i++) {
        ranks.set(entries[i].id, i + 1);
      }
      this.rankCache.set(metricName, ranks);
    }
    return ranks.get(node.id) ?? 0;
  }

  all(): NodeContext[] {
    return [...this.nodeMap.values()];
  }
}

/** Build NodeContext instances and a GraphContext for the given spec. */
function buildContexts(
  spec: DiagramSpec,
  topoIndex: Map<string, TopoEntry>,
  metricsIndex: MetricsIndex,
): { nodeCtxMap: Map<string, NodeContext>; graphCtx: GraphContext } {
  const nodeCtxs: NodeContext[] = [];
  const nodeCtxMap = new Map<string, NodeContext>();

  for (const node of spec.nodes) {
    const topo = topoIndex.get(node.id);
    if (!topo) continue;
    const ctx = new NodeContextImpl(
      node.id,
      node.type ?? "default",
      node.data ?? {},
      topo,
      metricsIndex,
    );
    nodeCtxs.push(ctx);
    nodeCtxMap.set(node.id, ctx);
  }

  for (const group of spec.groups) {
    const topo = topoIndex.get(group.id);
    if (!topo) continue;
    const ctx = new NodeContextImpl(
      group.id,
      "group",
      group.data ?? {},
      topo,
      metricsIndex,
    );
    nodeCtxs.push(ctx);
    nodeCtxMap.set(group.id, ctx);
  }

  const graphCtx = new GraphContextImpl(nodeCtxs, spec.edges);
  return { nodeCtxMap, graphCtx };
}

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

export function matchObjectCondition(
  ctx: NodeContext,
  match: MatchCondition,
): boolean {
  if (match.type !== undefined && ctx.type !== match.type) return false;
  if (match.id !== undefined && ctx.id !== match.id) return false;
  if (match.data !== undefined) {
    for (const [key, matcher] of Object.entries(match.data)) {
      const value = ctx.data[key];
      if (isNumericCond(matcher)) {
        if (typeof value !== "number") return false;
        if (!matchNumericCond(value, matcher)) return false;
      } else {
        if (value !== matcher) return false;
      }
    }
  }
  if (
    match.topology !== undefined &&
    !matchTopologyCond(ctx.topology, match.topology)
  )
    return false;
  return true;
}

function matchCondition(
  ctx: NodeContext,
  graphCtx: GraphContext,
  match: MatchCondition | MatchPredicate,
): boolean {
  if (typeof match === "function") {
    try {
      return match(ctx, graphCtx);
    } catch (err) {
      console.warn("Style match predicate threw:", err);
      return false;
    }
  }
  return matchObjectCondition(ctx, match);
}

/** Resolve a style value (object or function) to a StyleDescriptor. */
function resolveStyleValue(
  style: StyleDescriptor | StyleFunction,
  ctx: NodeContext,
  graphCtx: GraphContext,
): StyleDescriptor | undefined {
  if (typeof style === "function") {
    try {
      return style(ctx, graphCtx);
    } catch (err) {
      console.warn("Style function threw:", err);
      return undefined;
    }
  }
  return style;
}

// ---------------------------------------------------------------------------
// Full resolution
// ---------------------------------------------------------------------------

/** Shared setup for style and display-mode resolution. */
function prepareResolution(
  spec: DiagramSpec,
  rules: readonly StyleRuleDescriptor[],
  metricsIndex: MetricsIndex,
) {
  const topoIndex = buildTopologyIndex(spec);
  const { nodeCtxMap, graphCtx } = buildContexts(spec, topoIndex, metricsIndex);
  const sorted = [...rules].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
  );
  return { nodeCtxMap, graphCtx, sorted };
}

/**
 * Evaluate style rules against a DiagramSpec and return a new spec
 * with resolved styles baked into nodes and groups.
 */
export function resolveStyleRules(
  spec: DiagramSpec,
  rules: readonly StyleRuleDescriptor[],
  metricsIndex: MetricsIndex = new Map(),
): DiagramSpec {
  if (rules.length === 0) return spec;

  const { nodeCtxMap, graphCtx, sorted } = prepareResolution(
    spec,
    rules,
    metricsIndex,
  );

  function resolveStyle(
    id: string,
    existingStyle: NodeStyle | undefined,
  ): NodeStyle | undefined {
    const ctx = nodeCtxMap.get(id);
    if (!ctx) return existingStyle;

    let result: NodeStyle | undefined = existingStyle;

    for (const rule of sorted) {
      if (matchCondition(ctx, graphCtx, rule.match)) {
        const resolved = resolveStyleValue(rule.style, ctx, graphCtx);
        if (!resolved) continue;
        // Strip layout-only fields (display, groupInto) — they are consumed
        // by the display transform pass, not by the visual style layer.
        const { display: _, groupInto: _g, ...visualStyle } = resolved;
        result = { ...result, ...visualStyle };
      }
    }
    return result;
  }

  const nodes: DiagramNode[] = spec.nodes.map((node) => {
    const style = resolveStyle(node.id, node.style);
    return style !== node.style ? { ...node, style } : node;
  });

  const groups: DiagramGroup[] = spec.groups.map((group) => {
    const style = resolveStyle(group.id, group.style);
    return style !== group.style ? { ...group, style } : group;
  });

  return { ...spec, nodes, groups, edges: spec.edges };
}

// ---------------------------------------------------------------------------
// Display-mode topology transforms
// ---------------------------------------------------------------------------

/**
 * Resolve the `display` mode for each node by evaluating style rules.
 * Returns a map from node id → { display, groupInto }.
 */
export function resolveDisplayModes(
  spec: DiagramSpec,
  rules: readonly StyleRuleDescriptor[],
  metricsIndex: MetricsIndex = new Map(),
): Map<string, { display: DisplayMode; groupInto?: string }> {
  const result = new Map<
    string,
    { display: DisplayMode; groupInto?: string }
  >();
  if (rules.length === 0) return result;

  const { nodeCtxMap, graphCtx, sorted } = prepareResolution(
    spec,
    rules,
    metricsIndex,
  );

  for (const [id, ctx] of nodeCtxMap) {
    let display: DisplayMode = "node";
    let groupInto: string | undefined;

    for (const rule of sorted) {
      if (matchCondition(ctx, graphCtx, rule.match)) {
        const resolved = resolveStyleValue(rule.style, ctx, graphCtx);
        if (!resolved) continue;
        if (resolved.display) display = resolved.display;
        if (resolved.groupInto !== undefined) groupInto = resolved.groupInto;
      }
    }

    if (display !== "node") {
      result.set(id, { display, groupInto });
    }
  }

  return result;
}

/**
 * Build a reverse-ref index: for each node id, which nodes reference it via edges.
 */
function buildRefByIndex(edges: readonly DiagramEdge[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = index.get(edge.target);
    if (existing) existing.push(edge.source);
    else index.set(edge.target, [edge.source]);
  }
  return index;
}

/**
 * Determine the unique owner of a node for group-child / inline transforms.
 * Returns the owner id, or undefined if ambiguous (multiple refs, no explicit groupInto).
 */
function resolveOwner(
  nodeId: string,
  groupInto: string | undefined,
  refBy: Map<string, string[]>,
  parentId: string | undefined,
): string | undefined {
  if (groupInto) return groupInto;
  if (parentId) return parentId;
  const refs = refBy.get(nodeId);
  if (refs && refs.length === 1) return refs[0];
  return undefined;
}

interface TransformPlan {
  hiddenIds: Set<string>;
  inlinedIds: Set<string>;
  reparentMap: Map<string, string>;
  inlineMap: Map<string, InlineEntry[]>;
}

/** Find label for an id that may be a node or a group. */
function findLabel(spec: DiagramSpec, id: string): string | undefined {
  const node = spec.nodes.find((n) => n.id === id);
  if (node) return node.label;
  const group = spec.groups.find((g) => g.id === id);
  return group?.label;
}

/** Find parentId for a node (groups don't have parentId). */
function findParentId(spec: DiagramSpec, id: string): string | undefined {
  return spec.nodes.find((n) => n.id === id)?.parentId;
}

/** Classify each display mode into the appropriate transform bucket. */
function buildTransformPlan(
  spec: DiagramSpec,
  displayModes: Map<string, { display: DisplayMode; groupInto?: string }>,
  refBy: Map<string, string[]>,
): TransformPlan {
  const hiddenIds = new Set<string>();
  const inlinedIds = new Set<string>();
  const reparentMap = new Map<string, string>();
  const inlineMap = new Map<string, InlineEntry[]>();

  for (const [nodeId, { display, groupInto }] of displayModes) {
    if (display === "hidden") {
      hiddenIds.add(nodeId);
      continue;
    }

    // Target can be a node or a group
    const label = findLabel(spec, nodeId);
    if (!label) continue;

    const parentId = findParentId(spec, nodeId);
    const owner = resolveOwner(nodeId, groupInto, refBy, parentId);
    if (!owner) continue; // ambiguous — skip

    if (display === "group-child") {
      reparentMap.set(nodeId, owner);
    } else if (display === "inline") {
      // Groups can't hold inlineChildren — fall back to group-child
      const ownerIsGroup = spec.groups.some((g) => g.id === owner);
      if (ownerIsGroup) {
        reparentMap.set(nodeId, owner);
      } else {
        inlinedIds.add(nodeId);
        const existing = inlineMap.get(owner);
        const entry: InlineEntry = { id: nodeId, label };
        if (existing) existing.push(entry);
        else inlineMap.set(owner, [entry]);
      }
    }
  }

  return { hiddenIds, inlinedIds, reparentMap, inlineMap };
}

/** Transform a single node: apply reparenting, inline children, or clear orphaned parent. */
function transformNode(
  node: DiagramNode,
  plan: TransformPlan,
  orphanedParents: Set<string>,
): DiagramNode {
  const newParent = plan.reparentMap.get(node.id);
  const inlineChildren = plan.inlineMap.get(node.id);
  const clearParent =
    node.parentId !== undefined && orphanedParents.has(node.parentId);

  if (!newParent && !inlineChildren && !clearParent) return node;

  return {
    ...node,
    ...(newParent ? { parentId: newParent } : {}),
    ...(clearParent && !newParent ? { parentId: undefined } : {}),
    ...(inlineChildren
      ? {
          inlineChildren: [...(node.inlineChildren ?? []), ...inlineChildren],
        }
      : {}),
  };
}

/** Rewrite nodes and groups: apply reparenting, inline children, and filter removed. */
function rewriteNodes(
  spec: DiagramSpec,
  plan: TransformPlan,
): { nodes: DiagramNode[]; groups: DiagramGroup[] } {
  const removedIds = new Set([...plan.hiddenIds, ...plan.inlinedIds]);

  // When a group is hidden, clear parentId from its orphaned children
  const orphanedParents = new Set(
    spec.groups.filter((g) => removedIds.has(g.id)).map((g) => g.id),
  );

  const nodes: DiagramNode[] = [];
  for (const node of spec.nodes) {
    if (removedIds.has(node.id)) continue;
    nodes.push(transformNode(node, plan, orphanedParents));
  }

  // Process groups: filter removed, apply reparenting
  const groups: DiagramGroup[] = [];
  for (const group of spec.groups) {
    if (removedIds.has(group.id)) continue;
    const newParent = plan.reparentMap.get(group.id);
    groups.push(newParent ? { ...group, parentId: newParent } : group);
  }

  // Promote owners to groups if they gained children via reparent
  const existingGroupIds = new Set(groups.map((g) => g.id));
  const newGroupIds = new Set<string>();
  for (const [, parentId] of plan.reparentMap) {
    if (!existingGroupIds.has(parentId)) newGroupIds.add(parentId);
  }

  const finalNodes: DiagramNode[] = [];
  for (const node of nodes) {
    if (newGroupIds.has(node.id)) {
      groups.push({ id: node.id, label: node.label, style: node.style });
    } else {
      finalNodes.push(node);
    }
  }

  return { nodes: finalNodes, groups };
}

/** Filter edges: remove those touching removed nodes or implicit parent edges. */
function rewriteEdges(spec: DiagramSpec, plan: TransformPlan): DiagramEdge[] {
  const removedIds = new Set([...plan.hiddenIds, ...plan.inlinedIds]);
  return spec.edges.filter((edge) => {
    if (removedIds.has(edge.source) || removedIds.has(edge.target))
      return false;
    if (plan.reparentMap.get(edge.target) === edge.source) return false;
    return true;
  });
}

/**
 * Apply display-mode topology transforms to a DiagramSpec.
 *
 * - `"hidden"`: removes the node and all its edges.
 * - `"group-child"`: re-parents the node into the referencing node.
 * - `"inline"`: collapses the node into a text line in the referencing node.
 *
 * For group-child and inline, if there are multiple referencing nodes and
 * no explicit `groupInto`, the transform is skipped (node stays as-is).
 */
export function applyDisplayTransforms(
  spec: DiagramSpec,
  displayModes: Map<string, { display: DisplayMode; groupInto?: string }>,
): DiagramSpec {
  if (displayModes.size === 0) return spec;

  const refBy = buildRefByIndex(spec.edges);
  const plan = buildTransformPlan(spec, displayModes, refBy);
  const { nodes, groups } = rewriteNodes(spec, plan);
  const edges = rewriteEdges(spec, plan);

  return { nodes, edges, groups };
}
