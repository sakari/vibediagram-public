/**
 * Step-introspection: evaluates thunks, validates results against paramsSchema,
 * wires instance.params and Blueprint.engine, and computes engineOnStart order.
 */

import {
  Blueprint,
  Distribution,
  InputNode,
  type ArraySentinel,
  type Engine,
  type Model,
  type Node,
  type RecordSentinel,
  type Registration,
  type SentinelMarker,
} from "@diagram/sim-model";

/** Result of introspect: registrations with params resolved and start order for Blueprints. */
export interface IntrospectionResult {
  /** All registrations (thunks evaluated, params wired). */
  registrations: Registration[];
  /** Blueprints in engineOnStart order (topological by ref deps; cycles broken by registration order). */
  startOrder: Node[];
  /** Map from registration name to the InputNode instance. */
  inputRegistry: Map<string, InputNode>;
}

/** Temporary shape for a registration plus its evaluated thunk result. */
interface RegistrationWithResult {
  reg: Registration;
  thunkResult: Record<string, unknown>;
}

/**
 * Evaluates all thunks iteratively until stable (handles nested model.create).
 * Returns registration–result pairs.
 */
function evaluateThunks(model: Model): RegistrationWithResult[] {
  const results = new Map<string, RegistrationWithResult>();

  for (;;) {
    const regs = model.registrations;
    let changed = false;

    for (const reg of regs) {
      if (results.has(reg.name)) continue;
      const thunkResult = reg.thunk();
      results.set(reg.name, { reg, thunkResult });
      changed = true;
    }

    if (!changed) break;
  }

  return [...results.values()];
}

/**
 * Evaluates thunks only for registrations not already in `existing`.
 * Used after applyDefaults to pick up nodes created by ref default factories.
 */
function evaluateNewThunks(
  model: Model,
  existing: RegistrationWithResult[],
): RegistrationWithResult[] {
  const known = new Set(existing.map((w) => w.reg.name));
  const newEntries: RegistrationWithResult[] = [];

  for (;;) {
    const regs = model.registrations;
    let changed = false;

    for (const reg of regs) {
      if (known.has(reg.name)) continue;
      const thunkResult = reg.thunk();
      newEntries.push({ reg, thunkResult });
      known.add(reg.name);
      changed = true;
    }

    if (!changed) break;
  }

  return newEntries;
}

/**
 * Fills in missing fields in a single thunkResult from sentinel defaults.
 * For ref sentinels with a defaultFactory, the factory is called to auto-create
 * the node. For primitive sentinels with defaultValue, the value is inserted
 * directly. Mutates thunkResult in place.
 *
 * Exported so the dynamic spawn path can reuse the same logic.
 */
export function fillDefaults(
  model: Model,
  regName: string,
  paramsSchema: Record<string, SentinelMarker>,
  thunkResult: Record<string, unknown>,
): void {
  for (const [key, sentinel] of Object.entries(paramsSchema)) {
    if (key in thunkResult) continue;

    if (sentinel.kind === "ref" && sentinel.defaultFactory != null) {
      // Factory receives the model and a derived name for the auto-created node.
      const created = sentinel.defaultFactory(model, `${regName}/${key}`);
      thunkResult[key] = created;
    } else if ("defaultValue" in sentinel) {
      thunkResult[key] = sentinel.defaultValue;
    }
  }
}

/** Applies fillDefaults to a batch of registration-result pairs. */
function applyDefaults(
  model: Model,
  withResults: RegistrationWithResult[],
): void {
  for (const { reg, thunkResult } of withResults) {
    fillDefaults(model, reg.name, reg.paramsSchema, thunkResult);
  }
}

/** Validates a ref sentinel value. Throws descriptive errors on mismatch. */
function validateRef(
  ctx: string,
  sentinel: SentinelMarker & { kind: "ref" },
  value: unknown,
): void {
  if (value == null || typeof value !== "object") {
    throw new Error(
      `${ctx}: expected instance of ${sentinel.target.name}, got ${typeof value}`,
    );
  }
  if (!(value instanceof sentinel.target)) {
    throw new Error(
      `${ctx}: expected instance of ${sentinel.target.name}, got ${(value as { constructor?: { name?: string } }).constructor?.name ?? "unknown"}`,
    );
  }
}

/** Validates an array sentinel value. Throws descriptive errors on mismatch. */
function validateArray(
  regName: string,
  field: string,
  sentinel: ArraySentinel<SentinelMarker>,
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    throw new Error(
      `registration '${regName}', field '${field}': expected array, got ${typeof value}`,
    );
  }
  for (let i = 0; i < value.length; i++) {
    validateValue(
      regName,
      `${field}[${String(i)}]`,
      sentinel.inner,
      value[i] as unknown,
    );
  }
}

/** Validates a record sentinel value. Throws descriptive errors on mismatch. */
function validateRecord(
  regName: string,
  field: string,
  sentinel: RecordSentinel<Record<string, SentinelMarker>>,
  value: unknown,
): void {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `registration '${regName}', field '${field}': expected object, got ${Array.isArray(value) ? "array" : typeof value}`,
    );
  }
  // TypeScript narrows unknown to object here; index access requires Record cast
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- TypeScript narrows unknown to object here; index access requires Record cast
  const obj = value as Record<string, unknown>;
  for (const k of Object.keys(sentinel.shape)) {
    if (!(k in obj)) {
      throw new Error(
        `registration '${regName}', field '${field}': missing key '${k}' in record`,
      );
    }
    validateValue(regName, `${field}.${k}`, sentinel.shape[k], obj[k]);
  }
}

/** Validates a single value against a sentinel marker. Throws descriptive errors on mismatch. */
function validateValue(
  regName: string,
  field: string,
  sentinel: SentinelMarker,
  value: unknown,
): void {
  const ctx = `registration '${regName}', field '${field}'`;

  switch (sentinel.kind) {
    case "ref": {
      validateRef(ctx, sentinel, value);
      return;
    }
    case "capacity":
    case "rate":
    case "duration":
      if (typeof value !== "number") {
        throw new Error(
          `${ctx}: expected number for ${sentinel.kind}, got ${typeof value}`,
        );
      }
      return;
    case "param":
      if (typeof value === "string" || typeof value === "number") return;
      if (Array.isArray(value)) {
        if (value.every((e) => typeof e === "string")) return;
        throw new Error(`${ctx}: param array must contain only strings`);
      }
      throw new Error(
        `${ctx}: expected string, number, or string[], got ${typeof value}`,
      );
    case "array": {
      validateArray(regName, field, sentinel, value);
      return;
    }
    case "record": {
      validateRecord(regName, field, sentinel, value);
      return;
    }
    default:
      throw new Error(
        `${ctx}: unknown sentinel kind '${(sentinel as { kind?: string }).kind ?? "unknown"}'`,
      );
  }
}

/** Validates thunk result against paramsSchema. Throws on first mismatch. */
function validateThunkResult(
  regName: string,
  paramsSchema: Record<string, SentinelMarker>,
  thunkResult: Record<string, unknown>,
): void {
  const schemaKeys = new Set(Object.keys(paramsSchema));
  const resultKeys = new Set(Object.keys(thunkResult));

  for (const k of schemaKeys) {
    if (!resultKeys.has(k)) {
      throw new Error(
        `registration '${regName}', field '${k}': missing (required by paramsSchema)`,
      );
    }
  }

  const metadataKeys = new Set(["label", "description"]);
  for (const k of resultKeys) {
    if (!schemaKeys.has(k) && !metadataKeys.has(k)) {
      throw new Error(
        `registration '${regName}', field '${k}': extra key not in paramsSchema`,
      );
    }
  }

  for (const k of schemaKeys) {
    validateValue(regName, k, paramsSchema[k], thunkResult[k]);
  }
}

/** Collects all ref targets from a thunk result value given a sentinel. */
function collectRefTargets(
  sentinel: SentinelMarker,
  value: unknown,
  out: unknown[],
): void {
  /* v8 ignore next -- value is always non-null after validation */
  if (value == null) return;

  switch (sentinel.kind) {
    case "ref": {
      if (value instanceof sentinel.target) {
        out.push(value);
      }
      return;
    }
    case "array": {
      if (Array.isArray(value)) {
        for (const v of value) {
          collectRefTargets(sentinel.inner, v, out);
        }
      }
      return;
    }
    case "record": {
      if (typeof value === "object" && !Array.isArray(value)) {
        // TypeScript narrows unknown to object here; index access requires Record cast
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- TypeScript narrows unknown to object here; index access requires Record cast
        const obj = value as Record<string, unknown>;
        for (const k of Object.keys(sentinel.shape)) {
          if (k in obj) {
            collectRefTargets(sentinel.shape[k], obj[k], out);
          }
        }
      }
      return;
    }
    default:
      return;
  }
}

/** Returns the registration that owns the given instance, or undefined. */
function findOwner(
  registrations: Registration[],
  instance: unknown,
): Registration | undefined {
  return registrations.find((r) => r.instance === instance);
}

/** Topological sort (Kahn) with cycle-breaking by registration index. */
function topologicalSort(
  registrations: Registration[],
  getDeps: (reg: Registration) => Registration[],
): Registration[] {
  const index = new Map<Registration, number>();
  registrations.forEach((r, i) => index.set(r, i));

  const inDegree = new Map<Registration, number>();
  for (const r of registrations) {
    inDegree.set(r, 0);
  }
  const adj = new Map<Registration, Registration[]>();
  for (const r of registrations) {
    adj.set(r, []);
  }

  const idx = (r: Registration): number => index.get(r) ?? 0;
  const deg = (r: Registration): number => inDegree.get(r) ?? 0;
  const neighbors = (r: Registration): Registration[] => adj.get(r) ?? [];

  for (const r of registrations) {
    const deps = getDeps(r);
    for (const d of deps) {
      if (index.has(d)) {
        neighbors(d).push(r);
        inDegree.set(r, deg(r) + 1);
      }
    }
  }

  const queue: Registration[] = registrations
    .filter((r) => deg(r) === 0)
    .sort((a, b) => idx(a) - idx(b));

  const order: Registration[] = [];
  while (queue.length > 0) {
    const r = queue.shift();
    if (!r) break;
    order.push(r);
    for (const next of neighbors(r)) {
      const d = deg(next) - 1;
      inDegree.set(next, d);
      if (d === 0) {
        queue.push(next);
        queue.sort((a, b) => idx(a) - idx(b));
      }
    }
  }

  // Any remaining (cycles) get appended in registration order
  const remaining = registrations.filter((r) => !order.includes(r));
  remaining.sort((a, b) => idx(a) - idx(b));
  return [...order, ...remaining];
}

/**
 * Wires a single registration: assigns resolved params and engine facade.
 * Shared by both the bulk introspect path and the dynamic spawn path.
 */
export function wireNode(
  instance: Node,
  name: string,
  thunkResult: Record<string, unknown>,
  engineFacadeFactory: (name: string) => Engine,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- instance.params is set to resolved thunk values
  (instance as { params?: Record<string, unknown> }).params = thunkResult;
  if (instance instanceof Blueprint) {
    instance.engine = engineFacadeFactory(name);
  }
  if (instance instanceof Distribution) {
    instance.engine = engineFacadeFactory(name);
  }
}

/**
 * Evaluates all thunks, validates results, wires instance.params and Blueprint.engine,
 * and returns registrations plus engineOnStart order for Blueprints.
 */
export function introspect(
  model: Model,
  engineFacadeFactory: (name: string) => Engine,
): IntrospectionResult {
  // Evaluate thunks, then apply defaults. Ref default factories may call
  // model.create(), adding new registrations. We loop: evaluate new thunks,
  // apply defaults to them, until no new registrations appear.
  const withResults = evaluateThunks(model);
  applyDefaults(model, withResults);

  // Pick up registrations created by ref default factories and loop until stable.
  for (;;) {
    const newEntries = evaluateNewThunks(model, withResults);
    if (newEntries.length === 0) break;
    withResults.push(...newEntries);
    applyDefaults(model, newEntries);
  }

  const registrations = withResults.map((w) => w.reg);

  // Copy label/description from thunk results onto registrations.
  // Thunk values take precedence over opts values set during model.create().
  for (const { reg, thunkResult } of withResults) {
    if (typeof thunkResult.label === "string") reg.label = thunkResult.label;
    if (typeof thunkResult.description === "string")
      reg.description = thunkResult.description;
  }

  for (const { reg, thunkResult } of withResults) {
    validateThunkResult(reg.name, reg.paramsSchema, thunkResult);
  }

  for (const { reg, thunkResult } of withResults) {
    wireNode(reg.instance, reg.name, thunkResult, engineFacadeFactory);
  }

  // Initialize InputNode instances: set value from resolved params.defaultValue
  const inputRegistry = new Map<string, InputNode>();
  for (const reg of registrations) {
    if (reg.instance instanceof InputNode) {
      reg.instance.value = reg.instance.params.defaultValue;
      inputRegistry.set(reg.name, reg.instance);
    }
  }

  const getDeps = (r: Registration): Registration[] => {
    const wr = withResults.find((w) => w.reg === r);
    if (!wr) return [];
    const targets: unknown[] = [];
    for (const [key, sentinel] of Object.entries(r.paramsSchema)) {
      const val = wr.thunkResult[key];
      collectRefTargets(sentinel, val, targets);
    }
    const deps: Registration[] = [];
    for (const t of targets) {
      const owner = findOwner(registrations, t);
      if (owner && owner !== r) deps.push(owner);
    }
    return deps;
  };

  const sortedRegs = topologicalSort(registrations, getDeps);
  const startOrder = sortedRegs
    .filter((r) => r.instance instanceof Blueprint)
    .map((r) => r.instance);

  return { registrations, startOrder, inputRegistry };
}
