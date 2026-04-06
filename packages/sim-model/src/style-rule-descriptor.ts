/**
 * Style rule descriptors — both declarative (object) and functional forms.
 *
 * Rules are created and consumed entirely within the simulation worker
 * (they never cross a worker boundary), so functions are allowed.
 * Resolved styles are baked into the DiagramSpec before it is sent
 * to the main thread.
 */

// ---------------------------------------------------------------------------
// Style — uses CSS property names as the common denominator
// ---------------------------------------------------------------------------

/**
 * Controls how a matched node participates in the diagram topology.
 *
 * - `"node"` — default; renders as a standalone node with edges.
 * - `"group-child"` — moves inside the node that references it (via parentId).
 *    Requires a single referencing node, or an explicit `groupInto` target.
 * - `"inline"` — collapses into a text line inside the referencing node.
 *    Same ownership rules as `"group-child"`.
 * - `"hidden"` — removes the node and all its edges from the diagram.
 */
export type DisplayMode = "node" | "group-child" | "inline" | "hidden";

/** Visual shape for a diagram node. */
export type NodeShape =
  | "rectangle"
  | "cylinder"
  | "diamond"
  | "rounded-rectangle"
  | "circle"
  | "hexagon";

/**
 * Visual style applied to a node. Uses CSS property names directly.
 * Mirrors NodeStyle in @diagram/diagram-view — kept separate to avoid
 * a dependency from the domain model onto the rendering package.
 */
export interface StyleDescriptor {
  readonly background?: string;
  readonly borderColor?: string;
  readonly borderWidth?: number;
  readonly opacity?: number;
  readonly boxShadow?: string;
  readonly shape?: NodeShape;
  /** Controls how this node appears in the topology. Defaults to "node". */
  readonly display?: DisplayMode;
  /** Explicit parent when display is "group-child" or "inline" and multiple nodes ref this one. */
  readonly groupInto?: string;
}

// ---------------------------------------------------------------------------
// Condition types — serializable predicates
// ---------------------------------------------------------------------------

/** Numeric comparison operators. */
export interface NumericCondition {
  readonly gt?: number;
  readonly gte?: number;
  readonly lt?: number;
  readonly lte?: number;
  readonly eq?: number;
}

/** Condition on node.data fields. Keys are data property names; values are matchers. */
export type DataCondition = Record<
  string,
  NumericCondition | string | number | boolean
>;

/** Condition on topology properties. */
export interface TopologyCondition {
  readonly inDegree?: NumericCondition | number;
  readonly outDegree?: NumericCondition | number;
  readonly isGroup?: boolean;
  readonly hasParent?: boolean;
}

/** Full match condition. All specified sub-conditions must be true (AND). */
export interface MatchCondition {
  /** Match on node type (e.g. "default", "group"). */
  readonly type?: string;
  /** Match on node ID. */
  readonly id?: string;
  /** Match on node.data values. */
  readonly data?: DataCondition;
  /** Match on graph topology. */
  readonly topology?: TopologyCondition;
}

// ---------------------------------------------------------------------------
// Topology & context types — used by function predicates
// ---------------------------------------------------------------------------

/** Topology metadata for a node/group in the diagram. */
export interface TopoEntry {
  inDegree: number;
  outDegree: number;
  isGroup: boolean;
  hasParent: boolean;
}

/**
 * Per-node context passed to function predicates.
 * Provides access to the node's properties, topology, and metric values.
 */
export interface NodeContext {
  readonly id: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly topology: TopoEntry;

  /** Get the current value of a metric owned by this node. Returns undefined if not found. */
  metric(name: string): number | undefined;
}

/**
 * Graph-level context passed to function predicates.
 * Provides traversal and aggregation over the full diagram.
 */
export interface GraphContext {
  /** Nodes that have edges pointing TO the given node. */
  referrers(node: NodeContext): NodeContext[];

  /** Nodes that the given node points TO via edges. */
  targets(node: NodeContext): NodeContext[];

  /**
   * Rank of this node's metric value among all nodes (1 = highest).
   * Returns 0 if the node does not have the given metric.
   */
  rank(node: NodeContext, metricName: string): number;

  /** All nodes in the graph. */
  all(): NodeContext[];
}

// ---------------------------------------------------------------------------
// Function predicate types
// ---------------------------------------------------------------------------

/** Function form of a match condition. Must be pure (may be called multiple times per pass). */
export type MatchPredicate = (
  node: NodeContext,
  graph: GraphContext,
) => boolean;

/** Function form of a style. Must be pure (may be called multiple times per pass). */
export type StyleFunction = (
  node: NodeContext,
  graph: GraphContext,
) => StyleDescriptor;

// ---------------------------------------------------------------------------
// Rule descriptor
// ---------------------------------------------------------------------------

/**
 * A style rule that users define in their simulation code.
 * Both match and style accept either a declarative object or a function.
 */
export interface StyleRuleDescriptor {
  /** Human-readable name for debugging. */
  readonly name?: string;
  /** Priority for ordering (higher = applied later = wins conflicts). */
  readonly priority?: number;
  /** Condition that must be true for the style to apply. Object or function. */
  readonly match: MatchCondition | MatchPredicate;
  /** CSS-like style to apply when the condition matches. Object or function. */
  readonly style: StyleDescriptor | StyleFunction;
}
