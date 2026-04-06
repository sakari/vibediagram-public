/**
 * Web Worker that evaluates compiled user JS against @diagram/sim-model
 * globals, extracts topology as DiagramSpec, and drives the engine.
 */
import * as simModel from "@diagram/sim-model";
import {
  Engine,
  Metric,
  InputNode,
  Node,
  createModel as realCreateModel,
  isSentinel,
  type InputDescriptor,
  type Model,
  type Registration,
  type MetricSnapshot,
  type SentinelMarker,
  type StyleRuleDescriptor,
} from "@diagram/sim-model";
import {
  createEngine,
  introspect,
  type EngineController,
} from "@diagram/sim-default-engine";
import type {
  InitRequest,
  SimCommand,
  SimMessage,
  TaggedMetricSnapshot,
} from "./protocol";
import type {
  DiagramSpec,
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
} from "@diagram/diagram-view";
import {
  resolveStyleRules,
  resolveDisplayModes,
  applyDisplayTransforms,
  type MetricsIndex,
} from "./resolve-styles";
import { runLoop, reanchorSpeed, type RunLoopState } from "./run-loop";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentEngine: EngineController | null = null;
let currentRegistrations: Registration[] | null = null;

/** Shared run-loop state, mutated by both the loop and command handlers. */
const loopState: RunLoopState = {
  running: false,
  paused: false,
  speedMultiplier: 1,
  displaySimTime: 0,
  wallAnchor: 0,
  simAnchor: 0,
};

/** Production clock using real timers. */
const realClock = {
  now: () => performance.now(),
  delay: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};
let currentInputRegistry: Map<string, InputNode> | null = null;
let currentStyleRules: readonly StyleRuleDescriptor[] = [];
/** Default style rules collected from Blueprint classes and instances, priority-offset by -1e9. */
let currentDefaultStyleRules: readonly StyleRuleDescriptor[] = [];
let currentMetricOwnership: Record<string, string[]> = {};
/** The latest un-styled topology, used for re-resolving styles on each snapshot. */
let currentTopology: DiagramSpec | null = null;
/** Set to true when dynamic nodes are spawned; cleared after the next snapshot includes the updated topology. */
let topologyDirty = false;

// ---------------------------------------------------------------------------
// Topology extraction
// ---------------------------------------------------------------------------

/**
 * Collect default style rules from Node registrations.
 * Class-level rules (static defaultStyleRules) are collected once per unique class.
 * Instance-level rules (defaultInstanceStyleRules) are collected per Blueprint registration.
 * All priorities are offset by -1e9 so user rules always win.
 */
function collectDefaultStyleRules(
  registrations: Registration[],
): StyleRuleDescriptor[] {
  const rules: StyleRuleDescriptor[] = [];
  const seenCtors = new Set<unknown>();

  for (const reg of registrations) {
    // Class-level rules: collect once per unique constructor (any Node subclass)
    if (!seenCtors.has(reg.instance.constructor)) {
      seenCtors.add(reg.instance.constructor);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- instance is a Node, so constructor has defaultStyleRules
      const ctor = reg.instance.constructor as typeof Node;
      for (const rule of ctor.defaultStyleRules()) {
        rules.push({ ...rule, priority: (rule.priority ?? 0) - 1e9 });
      }
    }

    // Instance-level rules from Blueprint registrations
    if (reg.defaultInstanceStyleRules) {
      for (const rule of reg.defaultInstanceStyleRules) {
        rules.push({ ...rule, priority: (rule.priority ?? 0) - 1e9 });
      }
    }
  }

  return rules;
}

/** Classify a non-Metric registration into a node or group. */
export function classifyRegistration(
  reg: Registration,
  metricOwnership: Record<string, string[]>,
  nodes: DiagramNode[],
  groups: DiagramGroup[],
): void {
  const label = reg.label ?? reg.name;
  if (reg.instance instanceof InputNode) {
    nodes.push({
      id: reg.name,
      label,
      type: "simInput",
      data: {
        inputKind: reg.instance.params.kind,
        min: reg.instance.params.min,
        max: reg.instance.params.max,
        step: reg.instance.params.step,
        defaultValue: reg.instance.params.defaultValue,
        ...(reg.description != null && { description: reg.description }),
      },
    });
  } else if (reg.name in metricOwnership) {
    groups.push({
      id: reg.name,
      label,
      data: {
        className: reg.className,
        ...(reg.description != null && { description: reg.description }),
      },
    });
  } else {
    nodes.push({
      id: reg.name,
      label,
      type: "default",
      data: {
        className: reg.className,
        ...(reg.description != null && { description: reg.description }),
      },
    });
  }
}

/** Create metric child nodes inside their owner groups. */
function addMetricNodes(
  registrations: Registration[],
  metricOwnership: Record<string, string[]>,
  nodes: DiagramNode[],
): void {
  for (const [ownerName, metricNames] of Object.entries(metricOwnership)) {
    for (const mName of metricNames) {
      const metricReg = registrations.find((r) => r.name === mName);
      const displayName = metricReg?.label ?? mName;
      const className = metricReg?.className ?? mName;
      nodes.push({
        id: mName,
        label: `${displayName} (${className})`,
        type: "metric",
        parentId: ownerName,
        data: {
          ...(metricReg?.description != null && {
            description: metricReg.description,
          }),
        },
      });
    }
  }
}

/**
 * Walks resolved registrations and produces a DiagramSpec (nodes + edges)
 * plus a metricOwnership map. Blueprints become nodes, ref params between
 * Blueprints become edges, ref params to Metrics populate metricOwnership.
 */
function extractTopology(registrations: Registration[]): {
  topology: DiagramSpec;
  metricOwnership: Record<string, string[]>;
} {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const groups: DiagramGroup[] = [];
  const metricOwnership: Record<string, string[]> = {};

  // First pass: process param-based edges to establish metric ownership.
  // This must complete before spawn edges so that the alreadyOwned check
  // in processSpawnEdges sees ownership from the actual consumers.
  for (const reg of registrations) {
    if (reg.instance instanceof Metric) continue;
    if (reg.instance instanceof InputNode) continue;
    processParamEdges(reg, registrations, edges, metricOwnership);
  }

  // Second pass: process spawn-based edges. Metrics already claimed via
  // params won't be re-claimed by the spawner.
  for (const reg of registrations) {
    if (reg.instance instanceof Metric) continue;
    if (reg.instance instanceof InputNode) continue;
    processSpawnEdges(reg, registrations, edges, metricOwnership);
  }

  // Blueprints that own metrics become groups; InputNodes get type "simInput"; the rest become plain nodes.
  for (const reg of registrations) {
    if (reg.instance instanceof Metric) continue;
    classifyRegistration(reg, metricOwnership, nodes, groups);
  }

  // Add metric registrations as child nodes inside their owner's group.
  addMetricNodes(registrations, metricOwnership, nodes);

  // Collect default style rules from Blueprint classes and instances
  currentDefaultStyleRules = collectDefaultStyleRules(registrations);

  return {
    topology: { nodes, edges, groups },
    metricOwnership,
  };
}

function isPlainObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Extract edges and metric ownership from a single registration's params. */
function processParamEdges(
  reg: Registration,
  registrations: Registration[],
  edges: DiagramEdge[],
  metricOwnership: Record<string, string[]>,
): void {
  for (const [key, sentinel] of Object.entries(reg.paramsSchema)) {
    if (!isSentinel(sentinel)) continue;

    const paramsValue: unknown = Reflect.get(reg.instance, "params");
    const resolvedValue: unknown = isPlainObject(paramsValue)
      ? Reflect.get(paramsValue, key)
      : undefined;
    const targets = collectRefTargets(sentinel, resolvedValue);

    for (const target of targets) {
      addEdgeOrMetric(reg, key, target, registrations, edges, metricOwnership);
    }
  }
}

/**
 * Process spawn-based edges for a registration. Must be called AFTER all
 * param edges have been processed so that the alreadyOwned check correctly
 * detects metrics claimed by the actual consumer (e.g. Replica owns
 * replica-qps via its params, even though DB spawned both).
 */
function processSpawnEdges(
  reg: Registration,
  registrations: Registration[],
  edges: DiagramEdge[],
  metricOwnership: Record<string, string[]>,
): void {
  for (const childName of reg.spawnChildren) {
    const childReg = registrations.find((r) => r.name === childName);
    if (!childReg) continue;
    if (childReg.instance instanceof Metric) {
      // Spawned metrics become owned by the spawner (for grouping in the
      // diagram) unless they are already owned by another node via params.
      const alreadyOwned = Object.values(metricOwnership).some((names) =>
        names.includes(childName),
      );
      if (!alreadyOwned) {
        const existing = metricOwnership[reg.name] as string[] | undefined;
        if (!existing) metricOwnership[reg.name] = [childName];
        else existing.push(childName);
      }
    } else {
      edges.push({
        id: `${reg.name}-spawns-${childName}`,
        source: reg.name,
        target: childName,
        label: "spawns",
      });
    }
  }
}

function addEdgeOrMetric(
  reg: Registration,
  key: string,
  target: unknown,
  registrations: Registration[],
  edges: DiagramEdge[],
  metricOwnership: Record<string, string[]>,
): void {
  const targetReg = findOwner(registrations, target);
  if (!targetReg) return;

  if (targetReg.instance instanceof Metric) {
    const existing = metricOwnership[reg.name] as string[] | undefined;
    if (!existing) metricOwnership[reg.name] = [targetReg.name];
    else existing.push(targetReg.name);
  } else {
    edges.push({
      id: `${reg.name}-${key}-${targetReg.name}`,
      source: reg.name,
      target: targetReg.name,
      label: key,
    });
  }
}

function collectRefTargets(
  sentinel: SentinelMarker,
  value: unknown,
): unknown[] {
  const out: unknown[] = [];
  collectRefTargetsInner(sentinel, value, out);
  return out;
}

function collectRefTargetsInner(
  sentinel: SentinelMarker,
  value: unknown,
  out: unknown[],
): void {
  if (value == null) return;
  switch (sentinel.kind) {
    case "ref": {
      if (value instanceof sentinel.target) out.push(value);
      return;
    }
    case "array": {
      if (Array.isArray(value)) {
        for (const v of value) collectRefTargetsInner(sentinel.inner, v, out);
      }
      return;
    }
    case "record": {
      if (isPlainObject(value)) {
        for (const k of Object.keys(sentinel.shape)) {
          if (k in value)
            collectRefTargetsInner(
              sentinel.shape[k],
              Reflect.get(value, k),
              out,
            );
        }
      }
      return;
    }
    default:
      return;
  }
}

function findOwner(
  registrations: Registration[],
  instance: unknown,
): Registration | undefined {
  return registrations.find((r) => r.instance === instance);
}

// ---------------------------------------------------------------------------
// Style pipeline: display transforms → visual style resolution
// ---------------------------------------------------------------------------

/** Combine default style rules (priority-offset) with user rules. */
function allStyleRules(): readonly StyleRuleDescriptor[] {
  if (currentDefaultStyleRules.length === 0) return currentStyleRules;
  if (currentStyleRules.length === 0) return currentDefaultStyleRules;
  return [...currentDefaultStyleRules, ...currentStyleRules];
}

function applyStylePipeline(
  topology: DiagramSpec,
  rules: readonly StyleRuleDescriptor[],
  metricsIndex: MetricsIndex = new Map(),
): DiagramSpec {
  const displayModes = resolveDisplayModes(topology, rules, metricsIndex);
  const transformed = applyDisplayTransforms(topology, displayModes);
  return resolveStyleRules(transformed, rules, metricsIndex);
}

/**
 * Build a MetricsIndex from registrations: owner node id → metric name → first snapshot value.
 */
function buildMetricsIndex(
  registrations: Registration[],
  metricOwnership: Record<string, string[]>,
): MetricsIndex {
  const index: MetricsIndex = new Map();

  // Invert metricOwnership: metric name → owner node id
  const ownerOf = new Map<string, string>();
  for (const [owner, metricNames] of Object.entries(metricOwnership)) {
    for (const name of metricNames) {
      ownerOf.set(name, owner);
    }
  }

  for (const reg of registrations) {
    if (!(reg.instance instanceof Metric)) continue;
    const owner = ownerOf.get(reg.name);
    if (!owner) continue;

    const snapshots: MetricSnapshot[] = reg.instance.metrics();
    if (snapshots.length === 0) continue;

    let ownerMap = index.get(owner);
    if (!ownerMap) {
      ownerMap = new Map();
      index.set(owner, ownerMap);
    }
    // Use the first snapshot's value (for Summaries, this is the first quantile)
    ownerMap.set(reg.name, snapshots[0].value.value);
  }

  return index;
}

// ---------------------------------------------------------------------------
// User code evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates a bundled IIFE with sim-model globals provided via
 * `__simModelGlobals`. The IIFE's `@diagram/sim-model` imports resolve to
 * a shim that reads from this object. Returns the captured Model from the
 * intercepted `createModel`.
 */
function evalUserCode(jsSource: string): Model {
  const captured: { model: Model | null } = { model: null };

  const interceptedCreateModel = (): Model => {
    const model = realCreateModel();
    captured.model = model;
    return model;
  };

  const simModelGlobals: Record<string, unknown> = {
    ...simModel,
    createModel: interceptedCreateModel,
    Model: null,
  };

  const sandbox = `
    var Math = Object.create(globalThis.Math);
    Math.random = function() { throw new Error("Math.random is not available in simulations \u2014 use engine.timeout for randomness"); };
    var Date = { now: function() { return 0; } };
  `;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- new Function() is required here to inject globals into user code
  const fn = new Function("__simModelGlobals", sandbox + "\n" + jsSource);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- fn is dynamically created to evaluate user code
  fn(simModelGlobals);

  if (captured.model === null) {
    throw new Error("User code did not call createModel()");
  }
  return captured.model;
}

// ---------------------------------------------------------------------------
// Snapshot collection
// ---------------------------------------------------------------------------

function collectTaggedSnapshots(
  registrations: Registration[],
): TaggedMetricSnapshot[] {
  const result: TaggedMetricSnapshot[] = [];
  for (const reg of registrations) {
    if (reg.instance instanceof Metric) {
      const snapshots: MetricSnapshot[] = reg.instance.metrics();
      for (const snap of snapshots) {
        result.push({ ...snap, nodeName: reg.name });
      }
    }
  }
  return result;
}

/**
 * If the topology has changed since the last snapshot, extracts and returns
 * the updated topology + metricOwnership and clears the dirty flag.
 * Returns undefined fields when topology is unchanged.
 */
function drainTopologyIfDirty(engine: EngineController): {
  topology?: DiagramSpec;
  metricOwnership?: Record<string, string[]>;
} {
  if (!topologyDirty) return {};
  topologyDirty = false;
  const regs = engine.registrations;
  currentRegistrations = regs;
  const { topology, metricOwnership } = extractTopology(regs);
  currentTopology = topology;
  currentMetricOwnership = metricOwnership;
  const metricsIndex = buildMetricsIndex(regs, metricOwnership);
  const styledTopology = applyStylePipeline(
    topology,
    allStyleRules(),
    metricsIndex,
  );
  return { topology: styledTopology, metricOwnership };
}

/** Re-resolve styles on the current topology with fresh metric values. */
function resolveCurrentStyles(): DiagramSpec | undefined {
  if (!currentTopology || !currentRegistrations) return undefined;
  const metricsIndex = buildMetricsIndex(
    currentRegistrations,
    currentMetricOwnership,
  );
  return applyStylePipeline(currentTopology, allStyleRules(), metricsIndex);
}

// ---------------------------------------------------------------------------
// Speed-controlled run loop
// ---------------------------------------------------------------------------

async function runThrottled(engine: EngineController): Promise<void> {
  await runLoop(engine, loopState, realClock);

  if (!loopState.paused) {
    loopState.displaySimTime = engine.currentTime;
    const metrics = collectTaggedSnapshots(engine.registrations);
    const haltReason = engine.haltResult?.reason;
    const topo = drainTopologyIfDirty(engine);
    send({
      type: "done",
      simTime: engine.currentTime,
      metrics,
      haltReason,
      ...topo,
    });
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function send(msg: SimMessage): void {
  self.postMessage(msg);
}

async function handleCommand(cmd: SimCommand): Promise<void> {
  try {
    switch (cmd.type) {
      case "preview":
        handlePreview(cmd.jsSource);
        break;
      case "init":
        handleInit({
          jsSource: cmd.jsSource,
          inputValues: cmd.inputValues,
        });
        break;
      case "start":
        handleStart();
        break;
      case "pause":
        handlePause();
        break;
      case "step":
        await handleStep();
        break;
      case "setSpeed":
        reanchorSpeed(
          loopState,
          currentEngine?.currentTime ?? 0,
          cmd.multiplier,
          realClock,
        );
        break;
      case "requestSnapshot":
        handleRequestSnapshot();
        break;
      case "setInput":
        handleSetInput(cmd.id, cmd.value);
        break;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (cmd.type === "preview") {
      send({ type: "previewError", message });
    } else {
      send({ type: "error", message });
    }
  }
}

function handleSetInput(id: string, value: number | boolean): void {
  const input = currentInputRegistry?.get(id);
  if (input) {
    const raw = typeof value === "number" ? value : value ? 1 : 0;
    // Clamp to the engine's declared bounds so stale frontend values
    // (e.g. from a model edit that tightened min/max) don't escape.
    input.value = Math.min(input.params.max, Math.max(input.params.min, raw));
  }
}

function handlePreview(jsSource: string): void {
  const model = evalUserCode(jsSource);
  currentStyleRules = model.styleRules;
  const { registrations } = introspect(model, () => new Engine());
  const { topology } = extractTopology(registrations);
  const styledTopology = applyStylePipeline(topology, allStyleRules());
  send({ type: "previewResult", topology: styledTopology });
}

function handleInit(request: InitRequest): void {
  const model = evalUserCode(request.jsSource);
  currentStyleRules = model.styleRules;
  loopState.displaySimTime = 0;
  const engine = createEngine(model, {
    seed: "sim",
    duration: undefined,
    onTopologyChange: () => {
      topologyDirty = true;
    },
  });
  currentEngine = engine;
  currentRegistrations = model.registrations;
  currentInputRegistry = engine.inputRegistry;

  // Hydrate the fresh engine's input registry from frontend-owned state
  // before we emit descriptors. This makes the engine rebuild transparent
  // to the UI: values the user set pre-Start survive the rebuild.
  for (const [id, value] of Object.entries(request.inputValues)) {
    handleSetInput(id, value);
  }

  // Build input descriptors from registry and notify the main thread
  const inputs: InputDescriptor[] = [];
  for (const [id, input] of currentInputRegistry) {
    const kind = String(input.params.kind) === "boolean" ? "boolean" : "number";
    inputs.push({
      id,
      label: id,
      kind,
      min: input.params.min,
      max: input.params.max,
      step: input.params.step,
      defaultValue: input.params.defaultValue,
    });
  }
  if (inputs.length > 0) {
    send({ type: "inputsRegistered", inputs });
  }

  const { topology, metricOwnership } = extractTopology(currentRegistrations);
  currentTopology = topology;
  currentMetricOwnership = metricOwnership;
  const styledTopology = applyStylePipeline(topology, allStyleRules());
  send({
    type: "initialized",
    topology: styledTopology,
    metricOwnership,
  });
}

function handleStart(): void {
  if (!currentEngine) {
    send({ type: "error", message: "No engine initialized" });
    return;
  }
  runThrottled(currentEngine).catch((err: unknown) => {
    send({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

function handlePause(): void {
  loopState.paused = true;
  loopState.running = false;
  currentEngine?.pause();
}

async function handleStep(): Promise<void> {
  if (!currentEngine) {
    send({ type: "error", message: "No engine initialized" });
    return;
  }
  const stepped = await currentEngine.step();
  loopState.displaySimTime = currentEngine.currentTime;
  const metrics = collectTaggedSnapshots(currentEngine.registrations);
  const topo = drainTopologyIfDirty(currentEngine);
  // Re-resolve styles with fresh metrics even if topology hasn't changed
  const topology = topo.topology ?? resolveCurrentStyles();
  if (!stepped && currentEngine.haltResult) {
    send({
      type: "done",
      simTime: currentEngine.currentTime,
      metrics,
      haltReason: currentEngine.haltResult.reason,
      topology,
      metricOwnership: topo.metricOwnership,
    });
  } else {
    send({
      type: "snapshot",
      simTime: currentEngine.currentTime,
      metrics,
      topology,
      metricOwnership: topo.metricOwnership,
    });
  }
}

/** Interval (ms) at which metric-based style rules are re-evaluated. */
const STYLE_REFRESH_INTERVAL_MS = 200;
let lastStyleRefreshTime = 0;

function handleRequestSnapshot(): void {
  if (!currentEngine) {
    send({ type: "error", message: "No engine initialized" });
    return;
  }
  const metrics = collectTaggedSnapshots(currentEngine.registrations);
  const topo = drainTopologyIfDirty(currentEngine);

  // Periodically re-resolve metric-based styles (e.g. overloaded backends
  // changing color) without sending topology on every single frame.
  let topology = topo.topology;
  if (!topology) {
    const now = Date.now();
    if (now - lastStyleRefreshTime >= STYLE_REFRESH_INTERVAL_MS) {
      lastStyleRefreshTime = now;
      topology = resolveCurrentStyles();
    }
  } else {
    lastStyleRefreshTime = Date.now();
  }

  send({
    type: "snapshot",
    simTime: loopState.displaySimTime,
    metrics,
    topology,
    metricOwnership: topo.metricOwnership,
  });
}

self.onmessage = (event: MessageEvent<SimCommand>) => {
  void handleCommand(event.data);
};
