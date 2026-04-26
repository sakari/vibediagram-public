import type { StyleRuleDescriptor } from "./style-rule-descriptor";

/**
 * Minimal structural view of a registration that `Node.set()` mutates.
 * The concrete Registration type lives in model.ts and carries more
 * fields; we only need pendingParams and the wired flag here, so use a
 * structural type to avoid an import cycle with model.ts.
 */
interface PendingHolder {
  pendingParams: Record<string, unknown>;
  readonly wired: boolean;
}

// Framework-private map: instance → its registration's pending-params holder.
// Populated by Model.create (static registration) and Engine.spawn (dynamic
// registration). Uses a WeakMap so framework-internal pendingByInstance does
// not itself prevent GC of nodes — though in practice a Model also retains
// each registration (and therefore its instance) strongly via _registrations,
// so an instance cannot be collected while its Model is still live.
const pendingByInstance = new WeakMap<Node, PendingHolder>();

/**
 * Binds a Node instance to the registration that owns its pending params.
 * Called by the framework at registration time. Not intended for user code.
 */
export function bindPending(instance: Node, holder: PendingHolder): void {
  pendingByInstance.set(instance, holder);
}

/**
 * Base class for all simulation components. Nodes have no lifecycle and no
 * engine access. The framework sets `name` via model.create; subclasses declare
 * their params shape on the class itself (`static params = { … }`) plus an
 * instance mirror (`declare params: typeof Self.params`) that the engine
 * assigns during introspection.
 */
export class Node {
  /** Set by the framework during model.create; never by user code. */
  name = "";

  constructor() {
    // Copy the class's static params schema onto the instance so user code
    // that reads `this.params.x` (or that instantiates a Node directly in a
    // unit test) sees the sentinel values. The engine overwrites this with
    // resolved values during wireNode(). If the subclass declares no static
    // params, the instance's params stays undefined until wiring.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- bridging `this.constructor` (typed as Function) to the class's optional static params shape
    const ctor = this.constructor as { params?: Record<string, unknown> };
    if (ctor.params) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- assigning the declared (but uninitialised) instance `params` field from the static schema copy
      (this as { params?: Record<string, unknown> }).params = {
        ...ctor.params,
      };
    }
  }

  /**
   * Static style rules collected once per class, matching all instances of this
   * Node type. Override in subclasses to provide class-wide default styles.
   *
   * All default rules run at lower priority than rules added via
   * `model.addStyleRules()`.
   */
  static defaultStyleRules(): StyleRuleDescriptor[] {
    return [];
  }

  /**
   * Patches this node's pending params. Used for circular wiring, where
   * two nodes reference each other and cannot both be supplied at
   * construction:
   *
   *     const queue = model.create("queue", Queue);
   *     const producer = model.create("producer", Producer, { queue });
   *     queue.wire({ producer });
   *
   * Accepts a partial of the resolved params shape. Returns `this` so
   * multiple patches can chain, though a single call is idiomatic.
   *
   * Only valid between registration and introspection. Calling `wire()`
   * after the engine has wired `instance.params` throws, since the
   * mutation would not take effect. For dynamic wiring during simulation,
   * use `engine.spawn()` from within a Blueprint.
   *
   * Named `wire` (not `set`) to avoid clashing with Gauge.set and similar
   * user-facing mutators on Metric subclasses.
   */
  wire<T extends Node>(this: T, patch: Partial<InstanceParams<T>>): T {
    const holder = pendingByInstance.get(this);
    if (!holder) {
      throw new Error(
        `Node '${this.name}' is not registered — wire() requires the node to have been returned from model.create() or engine.spawn()`,
      );
    }
    if (holder.wired) {
      throw new Error(
        `Node '${this.name}' is already wired — wire() cannot be called after introspection. For dynamic wiring during simulation, use engine.spawn().`,
      );
    }
    Object.assign(holder.pendingParams, patch);
    return this;
  }
}

/**
 * Resolved params shape of an instance, derived from its `declare params`
 * mirror. The static schema on the class carries sentinels that, via
 * `component.*` type-lies, are typed as their resolved values. Each subclass
 * must write `declare params: typeof Self.params` for this to flow correctly.
 */
export type InstanceParams<T extends Node> = T extends { params: infer P }
  ? P
  : Record<string, never>;

/**
 * Constructor shape for a Node subclass that optionally exposes a static
 * `params` schema. The static `params` carries sentinels that, via the
 * `component.*` type-lies, are typed as their resolved values — so
 * `typeof Class.params` is the shape every `create()` call must match.
 *
 * The static is typed as `object | undefined` (not `Record<string, unknown>`)
 * so that Node subclasses with a branded params type (e.g. Metric's
 * `MetricParams<U>`) don't need to add a string index signature just to
 * satisfy this constraint.
 *
 * Lives in node.ts (not model.ts) so blueprint.ts can reference it via a
 * single back-edge to node.ts without forming an import cycle.
 */
export interface NodeClass<T extends Node = Node> {
  new (): T;
  readonly params?: object;
}

/** Extracts the resolved static-params shape from a Node subclass. */
export type StaticParamsOf<C extends NodeClass> = C extends {
  readonly params: infer P;
}
  ? P
  : Record<string, never>;
