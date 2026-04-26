/**
 * Step-sentinels: marker objects used to declare the shape and semantics of
 * params on blueprint classes. The framework scans for these at runtime and
 * overwrites them with resolved values from the thunk.
 */

import type { Node } from "./node";

/** Symbol used as property key on sentinel marker objects. Enables reliable detection without string collisions. */
export const SENTINEL = Symbol.for("@diagram/sim-model/sentinel");

/**
 * Minimal interface for the model parameter in DefaultFactory. Matches Model's
 * create() signature without importing Model directly (avoids circular dep
 * with model.ts which imports from sentinel.ts).
 */
export interface ModelLike {
  create<T extends Node>(
    name: string,
    Class: new () => T,
    params?: Record<string, unknown>,
    opts?: { label?: string; description?: string },
  ): T;
}

/**
 * Factory callback that auto-creates a node when a ref field is missing from
 * the create() call. Called during introspection with the model instance and
 * the derived name for the new node.
 */
export type DefaultFactory = (model: ModelLike, name: string) => unknown;

/** Sentinel for a reference to another node class. Resolves to an instance of that class. */
export interface RefSentinel<
  T extends abstract new (...args: unknown[]) => unknown,
> {
  readonly [SENTINEL]: true;
  readonly kind: "ref";
  readonly target: T;
  /** When present, called during introspection to auto-create the referenced node if the thunk omits this field. */
  readonly defaultFactory?: DefaultFactory;
}

/** Numeric parameter with semantic intent (capacity, rate, or duration). All resolve to number. */
export interface NumericSentinel {
  readonly [SENTINEL]: true;
  readonly kind: "capacity" | "rate" | "duration";
  /** When present, used as the default value if the thunk omits this field. */
  readonly defaultValue?: number;
}

/** Generic parameter accepting string, number, or string array. */
export interface ParamSentinel {
  readonly [SENTINEL]: true;
  readonly kind: "param";
  /** When present, used as the default value if the thunk omits this field. */
  readonly defaultValue?: string | number | string[];
}

/** Ordered collection wrapping an inner sentinel type. */
export interface ArraySentinel<T extends SentinelMarker> {
  readonly [SENTINEL]: true;
  readonly kind: "array";
  readonly inner: T;
  /** When present, used as the default value if the thunk omits this field. */
  readonly defaultValue?: Array<unknown>;
}

/** Structured object with named sentinel fields. */
export interface RecordSentinel<T extends Record<string, SentinelMarker>> {
  readonly [SENTINEL]: true;
  readonly kind: "record";
  readonly shape: T;
}

/** Discriminated union of all sentinel variant types. All sentinels carry the SENTINEL symbol and a discriminator `kind`. */
export type SentinelMarker =
  | RefSentinel<abstract new (...args: unknown[]) => unknown>
  | NumericSentinel
  | ParamSentinel
  | ArraySentinel<SentinelMarker>
  | RecordSentinel<Record<string, SentinelMarker>>;

type Resolve<S> =
  S extends RefSentinel<infer C>
    ? InstanceType<C>
    : S extends NumericSentinel
      ? number
      : S extends ParamSentinel
        ? string | number | string[]
        : S extends ArraySentinel<infer Inner>
          ? Array<Resolve<Inner>>
          : S extends RecordSentinel<infer Shape>
            ? { [K in keyof Shape]: Resolve<Shape[K]> }
            : never;

/** Maps a params object of sentinel types to the runtime types that thunk must provide. */
export type ResolveParams<T extends Record<string, SentinelMarker>> = {
  [K in keyof T]: Resolve<T[K]>;
};

const marker = (
  kind: SentinelMarker["kind"],
  extra?: Record<string, unknown>,
): SentinelMarker => {
  // Strip undefined optional fields so `"defaultValue" in sentinel` is a
  // reliable presence check for defaults.
  const cleaned: Record<string, unknown> = {};
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) cleaned[k] = v;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- spread of Record<string,unknown> loses the symbol index; shape is correct by construction
  return Object.freeze({
    [SENTINEL]: true as const,
    kind,
    ...cleaned,
  }) as SentinelMarker;
};

/**
 * Sentinel factory methods for declaring params shape.
 *
 * Intentional type lie: each factory's return type is the *resolved* type
 * (e.g. `number`, `InstanceType<T>`) rather than `SentinelMarker`. This lets
 * callers write `params` objects that type-check against the resolved shape
 * without any casts at the call site. At runtime the value is always a
 * `SentinelMarker`; the engine replaces it with the real value before
 * blueprints run. The unsafe assertions below are the single boundary where
 * this lie is established — they cannot be avoided without changing the API.
 */
export const component = {
  /**
   * Reference to another node class. Resolves to InstanceType of that class.
   * Optionally accepts a factory to auto-create the node when the caller
   * omits this field.
   *
   * The target may be passed as either the class itself or an arrow thunk
   * returning the class — the thunk form is required when two classes
   * reference each other in their static params, since the second class
   * would otherwise be used before declaration.
   *
   * **Use an arrow function**, not a regular `function` expression, for the
   * lazy form. The runtime distinguishes the two by the absence of
   * `.prototype` on arrow functions; a `function` expression has a
   * `.prototype` and would be mistaken for a class itself, leading to a
   * confusing `instanceof` validation error at introspection time.
   */
  ref<T extends abstract new (...args: unknown[]) => unknown>(
    target: T | (() => T),
    defaultFactory?: DefaultFactory,
  ): InstanceType<T> {
    // Thunks (arrow functions) have no .prototype; classes do. Detect and
    // lazily resolve so callers can write `component.ref(() => OtherClass)`
    // for forward references. Use Reflect.get to probe the optional
    // property without narrowing the union type.
    const hasPrototype =
      typeof target === "function" &&
      Reflect.get(target, "prototype") !== undefined;
    const isLazy = !hasPrototype;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- isLazy=false means target is T (a class), not a thunk
    let cached: T | undefined = isLazy ? undefined : (target as T);
    const resolveTarget = (): T => {
      if (cached === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by isLazy branch above
        cached = (target as () => T)();
      }
      return cached;
    };

    // Build a frozen sentinel with `target` backed by a getter so the
    // resolution is deferred until the engine reads it.
    const sentinel: Record<string | symbol, unknown> = {
      [SENTINEL]: true as const,
      kind: "ref" as const,
    };
    Object.defineProperty(sentinel, "target", {
      get: resolveTarget,
      enumerable: true,
      configurable: false,
    });
    if (defaultFactory !== undefined) {
      sentinel.defaultFactory = defaultFactory;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional lie: sentinel stands in for resolved instance type at declaration time
    return Object.freeze(sentinel) as unknown as InstanceType<T>;
  },

  /** Capacity semantic: pool size, buffer size. Resolves to number. Optionally accepts a default value. */
  capacity(defaultValue?: number): number {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional lie: sentinel stands in for number at declaration time
    return marker("capacity", { defaultValue }) as unknown as number;
  },

  /** Rate semantic: ops/sec, throughput. Resolves to number. Optionally accepts a default value. */
  rate(defaultValue?: number): number {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional lie: sentinel stands in for number at declaration time
    return marker("rate", { defaultValue }) as unknown as number;
  },

  /** Duration semantic: timeout seconds, delay. Resolves to number. Optionally accepts a default value. */
  duration(defaultValue?: number): number {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional lie: sentinel stands in for number at declaration time
    return marker("duration", { defaultValue }) as unknown as number;
  },

  /** Generic param: string, number, or string[]. Used when semantic is unknown. Optionally accepts a default value. */
  param(defaultValue?: string | number | string[]): string | number | string[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional lie: sentinel stands in for param value at declaration time
    return marker("param", { defaultValue }) as unknown as
      | string
      | number
      | string[];
  },

  /** Ordered collection of inner sentinel type. Resolves to array. Optionally accepts a default value. */
  array<T>(inner: T, defaultValue?: T[]): T[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional lie: sentinel stands in for resolved array type at declaration time
    return marker("array", {
      inner: inner as unknown,
      defaultValue,
    }) as unknown as T[];
  },

  /** Structured object with named sentinel fields. Resolves to object. */
  record<T extends Record<string, unknown>>(shape: T): T {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional lie: sentinel stands in for resolved record type at declaration time
    return marker("record", { shape: shape as unknown }) as unknown as T;
  },
} as const;

/** Type guard: returns true if value is a sentinel marker (leaf or composite). */
export function isSentinel(value: unknown): value is SentinelMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    SENTINEL in value &&
    (value as Record<symbol, unknown>)[SENTINEL] === true
  );
}
