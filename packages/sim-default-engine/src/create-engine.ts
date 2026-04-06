/**
 * Creates the default step engine controller. Orchestrates introspection,
 * engineOnStart, and the event-driven run loop with deterministic scheduling.
 */

import {
  Blueprint,
  Engine,
  InputNode,
  Metric,
  type MetricSnapshot,
  type Model,
  type Node,
  type Registration,
} from "@diagram/sim-model";
import { EventQueue } from "./event-queue";
import { MicrotaskFlush } from "./flush";
import { fillDefaults, introspect, wireNode } from "./introspect";
import { PRNG } from "./prng";

/** Result of a halt: the reason provided and the simulated time at which it occurred. */
export interface HaltResult {
  reason: string;
  time: number;
}

/** Options for createEngine. */
export interface EngineOptions {
  /** Seed for deterministic PRNG (tiebreakers, etc.). */
  seed: string;
  /** Max simulated time; undefined = run until queue empty. */
  duration?: number;
  /**
   * Called when dynamic nodes are spawned, signalling that the topology has
   * changed. The consumer can query engine.registrations to get the current
   * list when ready (e.g. on next snapshot poll).
   */
  onTopologyChange?: () => void;
}

/** Controller returned by createEngine. Drives the simulation loop. */
export interface EngineController {
  /** Runs until queue empty, duration reached, or paused. */
  run(): Promise<void>;
  /** Processes exactly one event. Returns true if processed, false if queue empty or past duration. */
  step(): Promise<boolean>;
  /** Stops the run loop at the next iteration. */
  pause(): void;
  /** Collects metric snapshots from all Metric instances. */
  snapshot(): MetricSnapshot[];
  /** Current simulated time (starts at 0). */
  readonly currentTime: number;
  /** If the simulation was halted, contains the reason and time; otherwise undefined. */
  readonly haltResult: HaltResult | undefined;
  /** Map from registration name to InputNode instance. */
  readonly inputRegistry: Map<string, InputNode>;
  /** Current registrations including dynamically spawned nodes. */
  readonly registrations: Registration[];
}

/** Mutable ref shared between facade and run loop so timeout uses live currentTime. */
interface TimeRef {
  current: number;
}

/**
 * Installs a temporary unhandled-rejection listener that captures the first
 * rejection reason as a string. Returns a cleanup function that removes the
 * listener and returns the captured error (if any).
 *
 * Cross-environment: Node.js uses process.on('unhandledRejection'); browsers
 * use the 'unhandledrejection' event on globalThis.
 */
function installRejectionTrap(): {
  cleanup: () => string | undefined;
} {
  let caughtError: string | undefined;
  const extractMessage = (reason: unknown): string =>
    reason instanceof Error ? reason.message : String(reason);

  // Node.js path — access process via Reflect.get to avoid bare `process`
  // references (which require @types/node) and unsafe type assertions.
  const proc: unknown = Reflect.get(globalThis, "process");
  /* v8 ignore next 4 -- null-guard branches only taken in non-Node envs */
  const procOn: unknown =
    typeof proc === "object" && proc !== null
      ? Reflect.get(proc, "on")
      : undefined;
  /* v8 ignore next 4 -- null-guard branches only taken in non-Node envs */
  const procOff: unknown =
    typeof proc === "object" && proc !== null
      ? Reflect.get(proc, "removeListener")
      : undefined;

  if (typeof procOn === "function" && typeof procOff === "function") {
    /* v8 ignore next -- else branch only in non-Node */
    const handler = (reason: unknown) => {
      if (caughtError === undefined) caughtError = extractMessage(reason);
    };
    Reflect.apply(procOn, proc, ["unhandledRejection", handler]);
    return {
      cleanup: () => {
        Reflect.apply(procOff, proc, ["unhandledRejection", handler]);
        return caughtError;
      },
    };
  }

  /* v8 ignore start -- browser/worker path not exercised in Node tests */
  // Browser / web worker path
  if (typeof globalThis.addEventListener === "function") {
    const handler = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      if (caughtError === undefined) caughtError = extractMessage(event.reason);
    };
    globalThis.addEventListener("unhandledrejection", handler);
    return {
      cleanup: () => {
        globalThis.removeEventListener("unhandledrejection", handler);
        return caughtError;
      },
    };
  }

  // Fallback: no rejection capture available
  return { cleanup: () => undefined };
} /* v8 ignore stop */

/**
 * Creates an engine controller for the given model. Introspects, wires the
 * engine facade, calls engineOnStart on all Blueprints, then returns a
 * controller. run() flushes microtasks first so any timeouts scheduled
 * via microtasks during engineOnStart are enqueued before the loop.
 */
export function createEngine(
  model: Model,
  options: EngineOptions,
): EngineController {
  const queue = new EventQueue();
  const flush = new MicrotaskFlush();
  const timeRef: TimeRef = { current: 0 };
  const duration = options.duration;

  /** Batch topology change notifications within a microtask to avoid thrashing. */
  let topologyChangePending = false;
  function scheduleTopologyChange(): void {
    if (topologyChangePending || !options.onTopologyChange) return;
    topologyChangePending = true;
    queueMicrotask(() => {
      topologyChangePending = false;
      options.onTopologyChange?.();
    });
  }

  /**
   * Dynamically registers a new node. Reuses model.create() for sentinel
   * scanning and registration, then wireNode() for params + engine facade
   * wiring — the same calls used by the static introspect path.
   */
  function spawnNode<T extends Node>(
    name: string,
    Class: new () => T,
    thunk?: () => Record<string, unknown>,
    parentName?: string,
  ): T {
    // Default to empty-object thunk when caller omits it (mirrors Model.create behaviour).
    const resolvedThunk = thunk ?? (() => ({}));

    // model.create handles: new instance, sentinel scanning, registration
    const instance = model.create(name, Class, resolvedThunk);

    // Apply sentinel defaults to fill missing fields (same as introspect path).
    const reg = model.registrations.find((r) => r.name === name);
    const thunkResult = resolvedThunk();
    if (reg) {
      fillDefaults(model, name, reg.paramsSchema, thunkResult);
    }

    // wireNode handles: params assignment + engine facade wiring (same as introspect)
    wireNode(instance, name, thunkResult, createEngineFacade);

    // Record spawn relationship so topology extraction can draw edges
    if (parentName) {
      const parentReg = model.registrations.find((r) => r.name === parentName);
      if (parentReg) {
        parentReg.spawnChildren.push(name);
      }
    }

    if (instance instanceof Blueprint) {
      instance.engineOnStart();
    }

    scheduleTopologyChange();
    return instance;
  }

  function createEngineFacade(name: string): Engine {
    const nodePrng = new PRNG(`${options.seed}:${name}`);
    return new (class extends Engine {
      override timeout(seconds: number): Promise<void> {
        return new Promise((resolve) => {
          const t = timeRef.current + seconds;
          queue.push(t, nodePrng.random(), resolve);
        });
      }

      override random(): number {
        return nodePrng.random();
      }

      override halt(reason: string): void {
        // First-writer-wins: only the first halt call is recorded.
        if (haltResult === undefined) {
          haltResult = { reason, time: timeRef.current };
        }
      }

      override spawn<T extends Node>(
        spawnName: string,
        SpawnClass: new () => T,
        spawnThunk?: () => Record<string, unknown>,
      ): T {
        return spawnNode(spawnName, SpawnClass, spawnThunk, name);
      }

      override now(): number {
        return timeRef.current;
      }
    })();
  }

  let paused = false;
  let haltResult: HaltResult | undefined;

  const { startOrder, inputRegistry } = introspect(model, createEngineFacade);

  for (const node of startOrder) {
    if (node instanceof Blueprint) {
      node.engineOnStart();
    }
  }

  /** Returns true if the run loop should stop. Extracted into a function to
   * prevent TypeScript's control-flow analysis from treating the flag as a
   * compile-time constant after `paused = false`. */
  function shouldStop(): boolean {
    return paused || haltResult !== undefined;
  }

  async function processOne(): Promise<boolean> {
    const entry = queue.peek();
    if (!entry) return false;
    if (duration !== undefined && entry.time > duration) return false;
    queue.pop();
    timeRef.current = entry.time;

    const trap = installRejectionTrap();
    try {
      entry.resolve();
      await flush.flush();
    } finally {
      const caughtError = trap.cleanup();
      if (caughtError !== undefined && haltResult === undefined) {
        haltResult = { reason: caughtError, time: timeRef.current };
      }
    }

    // Run invariant checks on all Blueprints after each flush [sc-all-blueprints].
    // Uses model.registrations to include dynamically spawned nodes.
    // No flush follows invariant execution [sc-no-reentrance].
    // Each call is guarded: a throwing invariant becomes a halt (first-writer-wins)
    // and does not skip remaining Blueprints.
    for (const reg of model.registrations) {
      if (reg.instance instanceof Blueprint) {
        try {
          reg.instance.engineCheckInvariant();
        } catch (err: unknown) {
          if (haltResult === undefined) {
            const reason = err instanceof Error ? err.message : String(err);
            haltResult = { reason, time: timeRef.current };
          }
        }
      }
    }

    return true;
  }

  async function run(): Promise<void> {
    paused = false;
    // engineOnStart() may fire-and-forget async work (e.g. calling an async
    // method without await). Those calls create promises whose microtask
    // continuations schedule engine.timeout(). Flushing before the loop
    // ensures those timeouts are enqueued before we start processing events.
    await flush.flush();
    while (!shouldStop() && (await processOne()));
  }

  async function step(): Promise<boolean> {
    if (haltResult !== undefined) return false;
    return processOne();
  }

  function pause(): void {
    paused = true;
  }

  function snapshot(): MetricSnapshot[] {
    const snapshots: MetricSnapshot[] = [];
    // Use model.registrations to include dynamically spawned nodes
    for (const reg of model.registrations) {
      if (reg.instance instanceof Metric) {
        snapshots.push(...reg.instance.metrics());
      }
    }
    return snapshots;
  }

  return {
    run,
    step,
    pause,
    snapshot,
    get currentTime() {
      return timeRef.current;
    },
    get haltResult() {
      return haltResult;
    },
    inputRegistry,
    /** Current registrations including dynamically spawned nodes. */
    get registrations(): Registration[] {
      return model.registrations;
    },
  };
}
