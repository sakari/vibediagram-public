/**
 * Step-model-builder: creates and registers nodes, reads the static params
 * schema from each Node subclass, and collects registrations for later
 * resolution by the engine package. Framework sentinels declared outside
 * `params` (e.g. on instance fields) are scanned from the instance.
 */

import { Blueprint } from "./blueprint";
import {
  Node,
  bindPending,
  type InstanceParams,
  type NodeClass,
  type StaticParamsOf,
} from "./node";
import { isSentinel, type SentinelMarker } from "./sentinel";
import type { StyleRuleDescriptor } from "./style-rule-descriptor";

/**
 * Stored metadata for a node registered via model.create. Used by the engine
 * package to resolve pending-params values into instance properties.
 */
export interface Registration {
  /** Node name set at registration. */
  name: string;
  /** Optional display label; falls back to name when absent. */
  label?: string;
  /** Optional human-readable description of what this node does. */
  description?: string;
  /** The node instance (params still hold sentinels until resolution). */
  instance: Node;
  /**
   * Params supplied via create() and subsequent .set() calls. Mutable until
   * introspection runs; the engine reads from this object, fills in missing
   * keys from sentinel defaults, and assigns the resolved object onto
   * instance.params.
   */
  pendingParams: Record<string, unknown>;
  /**
   * Set to true by the engine once this registration has been wired. After
   * wiring, `.set()` on the instance throws rather than silently mutating
   * state that nothing reads.
   */
  wired: boolean;
  /** Top-level keys of params and their sentinel markers (no recursion into composites). */
  paramsSchema: Record<string, SentinelMarker>;
  /** Own instance properties (excluding params, name) that hold sentinel values. */
  frameworkSentinels: Array<{ path: string; sentinel: SentinelMarker }>;
  /** Constructor name for diagnostics. */
  className: string;
  /** Names of nodes dynamically spawned by this node. */
  spawnChildren: string[];
  /** Per-instance default style rules returned by Blueprint.defaultInstanceStyleRules() at registration time. */
  defaultInstanceStyleRules?: readonly StyleRuleDescriptor[];
}

/**
 * Reads the static params schema from a Node subclass (no instantiation)
 * and records any framework sentinels found on the instance's own fields.
 */
function scanSchema(
  Class: NodeClass,
  instance: Node,
): {
  paramsSchema: Record<string, SentinelMarker>;
  frameworkSentinels: Array<{ path: string; sentinel: SentinelMarker }>;
} {
  const paramsSchema: Record<string, SentinelMarker> = {};
  const frameworkSentinels: Array<{
    path: string;
    sentinel: SentinelMarker;
  }> = [];

  const staticParams = Class.params;
  if (staticParams != null) {
    for (const [key, value] of Object.entries(staticParams)) {
      if (isSentinel(value)) {
        paramsSchema[key] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(instance as object)) {
    if (key === "params" || key === "name") continue;
    if (isSentinel(value)) {
      frameworkSentinels.push({ path: key, sentinel: value });
    }
  }

  return { paramsSchema, frameworkSentinels };
}

/**
 * Model builder that creates nodes, reads their static param schemas, and
 * stores registrations for later resolution. Use createModel() to obtain an
 * instance.
 */
export class Model {
  private _registrations: Registration[] = [];
  private _styleRules: StyleRuleDescriptor[] = [];

  /**
   * Creates a node instance, sets its name, reads the static params schema,
   * scans for framework sentinels, and stores the registration. Returns the
   * instance; the engine resolves params during introspection.
   *
   * Every node must go through model.create() to be registered. Only
   * sentinel fields declared in `static params` contribute to the visible
   * topology graph. Private instance fields that reference other nodes
   * create hidden dependencies invisible to the framework and UI layout —
   * `params` is the explicit contract for external visibility.
   *
   * The optional `params` arg may supply any subset of the resolved params
   * shape; missing keys are filled by sentinel defaults or by subsequent
   * `.set()` calls. For circular refs, omit the circular key at creation
   * and call `.set({ key: otherNode })` after the other node is created.
   *
   * The `InstanceType<C>` cast on `new Class()` is a typed internal bridge
   * between the generic `C` and the concrete instance returned by `new` —
   * a known TS limitation when the generic is constrained via an
   * interface rather than a bare constructor type. It is not equivalent
   * to `any`: the compiler has already verified that `C` has a zero-arg
   * constructor returning Node.
   */
  create<T extends Node>(
    name: string,
    Class: NodeClass<T>,
    params?: Partial<InstanceParams<T>>,
    opts?: { label?: string; description?: string },
  ): T {
    // Reject duplicate names eagerly. Without this, a second create() with
    // the same name would push a parallel registration that the engine's
    // first-match lookup never finds — silently breaking wire() on the
    // second instance and engine.spawn's wired flag for it.
    if (this._registrations.some((r) => r.name === name)) {
      throw new Error(
        `Model.create: duplicate name '${name}' (each registration must have a unique name)`,
      );
    }

    const instance: T = new Class();
    instance.name = name;

    // Collect per-instance default style rules before params are resolved.
    let instanceStyleRules: readonly StyleRuleDescriptor[] | undefined;
    if (instance instanceof Blueprint) {
      const rules = instance.defaultInstanceStyleRules();
      if (rules.length > 0) {
        instanceStyleRules = rules;
      }
    }

    const { paramsSchema, frameworkSentinels } = scanSchema(Class, instance);

    const pendingParams: Record<string, unknown> =
      params === undefined ? {} : { ...(params as Record<string, unknown>) };

    const registration: Registration = {
      name,
      label: opts?.label,
      description: opts?.description,
      instance,
      pendingParams,
      paramsSchema,
      frameworkSentinels,
      className: Class.name,
      spawnChildren: [],
      defaultInstanceStyleRules: instanceStyleRules,
      wired: false,
    };
    this._registrations.push(registration);
    bindPending(instance, registration);

    return instance;
  }

  /**
   * Registers declarative style rules that control how nodes appear in the
   * diagram. Rules are resolved once at init/preview time against the graph
   * topology and baked into the DiagramSpec.
   *
   * Later calls append to the existing rule set.
   */
  addStyleRules(rules: readonly StyleRuleDescriptor[]): void {
    this._styleRules.push(...rules);
  }

  /** All registrations in insertion order. */
  get registrations(): Registration[] {
    return [...this._registrations];
  }

  /** All style rules in insertion order. */
  get styleRules(): readonly StyleRuleDescriptor[] {
    return this._styleRules;
  }
}

/** Returns a new Model instance for building a simulation model. */
export function createModel(): Model {
  return new Model();
}

/** Re-export for callers that want to type custom helpers against the resolved params shape. */
export type { InstanceParams, NodeClass, StaticParamsOf };
