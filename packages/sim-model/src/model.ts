/**
 * Step-model-builder: creates and registers nodes, scans for sentinels in params
 * and framework fields. The model collects registrations for later resolution
 * by the engine package.
 */

import { Blueprint } from "./blueprint";
import { Node } from "./node";
import { isSentinel, type SentinelMarker } from "./sentinel";
import type { StyleRuleDescriptor } from "./style-rule-descriptor";

/** Maps a class's params type to the resolved shape. Node has no params; subclasses may extend. */
type ParamsOf<T extends Node> = T extends { params: infer P }
  ? P
  : Record<string, never>;

/**
 * Widens string-literal unions to plain string so that thunk return values
 * like `{ unit: "byte" }` (inferred as `{ unit: string }`) are accepted
 * without requiring `as const` or explicit casts. Non-string properties
 * (numbers, node refs) are left unchanged.
 */
type WidenStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K];
};

/**
 * Thunk return type for model.create(). When ParamsOf can infer the params
 * shape, the thunk is type-checked against it (with string unions widened).
 * When inference falls back to Record<string, never> (e.g. bare Node), we
 * accept any object. label and description are always accepted for metadata.
 */
type ThunkResult<T extends Node> = (ParamsOf<T> extends Record<string, never>
  ? Record<string, unknown>
  : Partial<WidenStrings<ParamsOf<T>>>) & {
  label?: string;
  description?: string;
};

/**
 * Stored metadata for a node registered via model.create. Used by the engine
 * package to resolve thunk values into instance properties.
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
  /** Thunk that supplies resolved values; return shape must match paramsSchema. */
  thunk: () => Record<string, unknown>;
  /** Top-level keys of params and their sentinel markers (no recursion into composites). */
  paramsSchema: Record<string, SentinelMarker>;
  /** Own properties (excluding params, name) that hold sentinel values. */
  frameworkSentinels: Array<{ path: string; sentinel: SentinelMarker }>;
  /** Constructor name for diagnostics. */
  className: string;
  /** Names of nodes dynamically spawned by this node. */
  spawnChildren: string[];
  /** Per-instance default style rules returned by Blueprint.defaultInstanceStyleRules() at registration time. */
  defaultInstanceStyleRules?: readonly StyleRuleDescriptor[];
}

/** Scan an instance for sentinel markers in params and own properties. */
function scanSentinels(instance: Node): {
  paramsSchema: Record<string, SentinelMarker>;
  frameworkSentinels: Array<{ path: string; sentinel: SentinelMarker }>;
} {
  const paramsSchema: Record<string, SentinelMarker> = {};
  const frameworkSentinels: Array<{
    path: string;
    sentinel: SentinelMarker;
  }> = [];

  const instanceEntries = Object.entries(instance as object);
  const paramsEntry = instanceEntries.find(([k]) => k === "params");
  const rawParams: unknown = paramsEntry?.[1];
  if (
    rawParams !== null &&
    typeof rawParams === "object" &&
    !Array.isArray(rawParams)
  ) {
    for (const [key, value] of Object.entries(rawParams)) {
      if (isSentinel(value)) {
        paramsSchema[key] = value;
      }
    }
  }

  for (const [key, value] of instanceEntries) {
    if (key === "params" || key === "name") continue;
    if (isSentinel(value)) {
      frameworkSentinels.push({ path: key, sentinel: value });
    }
  }

  return { paramsSchema, frameworkSentinels };
}

/**
 * Model builder that creates nodes, scans for sentinels, and stores registrations
 * for later resolution. Use createModel() to obtain an instance.
 */
export class Model {
  private _registrations: Registration[] = [];
  private _styleRules: StyleRuleDescriptor[] = [];

  /**
   * Creates a node instance, sets its name, scans for sentinels, and stores the
   * registration. Returns the instance; sentinels remain until the engine resolves them.
   *
   * Every node must go through model.create() to be registered. Only sentinel
   * fields declared in `params` (via component.ref(), etc.) contribute to the
   * visible topology graph. Private instance fields that reference other nodes
   * create hidden dependencies invisible to the framework and UI layout. This is
   * intentional — `params` is the explicit contract for external visibility.
   */
  create<T extends Node>(
    name: string,
    Class: new () => T,
    thunk?: () => ThunkResult<T>,
    opts?: { label?: string; description?: string },
  ): T {
    const instance = new Class();
    instance.name = name;

    // Collect per-instance default style rules before params are resolved.
    let instanceStyleRules: readonly StyleRuleDescriptor[] | undefined;
    if (instance instanceof Blueprint) {
      const rules = instance.defaultInstanceStyleRules();
      if (rules.length > 0) {
        instanceStyleRules = rules;
      }
    }

    const { paramsSchema, frameworkSentinels } = scanSentinels(instance);

    // Default to empty-object thunk when caller omits it (ref defaultFactory
    // or primitive defaultValue will fill in the missing fields during introspection).
    const emptyThunk = () => ({}) as Record<string, unknown>;
    const resolvedThunk =
      (thunk as (() => Record<string, unknown>) | undefined) ?? emptyThunk;

    const registration: Registration = {
      name,
      label: opts?.label,
      description: opts?.description,
      instance,
      thunk: resolvedThunk,
      paramsSchema,
      frameworkSentinels,
      className: Class.name,
      spawnChildren: [],
      defaultInstanceStyleRules: instanceStyleRules,
    };
    this._registrations.push(registration);

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
