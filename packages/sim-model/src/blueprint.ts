import { Node } from "./node";
import type { StyleRuleDescriptor } from "./style-rule-descriptor";

/**
 * Engine facade exposed to blueprints. The engine package replaces the instance
 * during resolution; before wiring, methods throw to signal misconfiguration.
 */
export class Engine {
  /**
   * Returns a promise that resolves after the given delay. Throws if the engine
   * has not been wired via createEngine().
   */
  timeout(_seconds: number): Promise<void> {
    throw new Error("Engine not wired — call createEngine() first");
  }

  /** Returns a seeded pseudorandom float in [0, 1). */
  random(): number {
    throw new Error("Engine not wired — call createEngine() first");
  }

  /**
   * Halts the simulation with the given reason. Once halted, the engine stops
   * processing further events and the run loop resolves. Throws if the engine
   * has not been wired via createEngine().
   */
  halt(_reason: string): void {
    throw new Error("Engine not wired — call createEngine() first");
  }

  /**
   * Dynamically creates and registers a new node during simulation runtime.
   * The node is wired synchronously within the current tick (params resolved,
   * engine facade assigned) and engineOnStart() is called immediately if it
   * is a Blueprint — so any timeouts it schedules start from the current
   * simulation time. Topology update notifications are batched via microtask
   * and delivered before the next event is processed.
   */
  spawn<T extends Node>(
    _name: string,
    _Class: new () => T,
    _thunk?: () => Record<string, unknown>,
  ): T {
    throw new Error("Engine not wired — call createEngine() first");
  }

  /** Returns the current simulated time in seconds. */
  now(): number {
    throw new Error("Engine not wired — call createEngine() first");
  }
}

/**
 * Node with simulation lifecycle. Has an engine reference (assigned by the
 * engine package during resolution) and hooks called at simulation start.
 */
export class Blueprint extends Node {
  /** Assigned by the engine package during resolution; use ! because wiring happens after construction. */
  engine!: Engine;

  /**
   * Called by the engine at simulation start. Override in subclasses to perform
   * setup. Default implementation is a no-op.
   */
  engineOnStart(): void {
    // Default: no-op
  }

  /**
   * Called by the engine synchronously after every flush (i.e., after all
   * microtask continuations from a simulated-time event have settled).
   * Override in subclasses to assert simulation-wide correctness properties.
   * Call this.engine.halt(reason) to stop the simulation on violation.
   * Must be synchronous — the engine does not await the return value.
   */
  engineCheckInvariant(): void {
    // Default: no-op
  }

  /**
   * Per-instance style rules called at registration time. `this.name` is
   * available for building match conditions, but `this.params` still holds
   * sentinel markers and must not be read.
   *
   * Style functions in the returned descriptors receive a `NodeContext` at
   * resolution time, providing access to metrics and topology.
   *
   * Override in subclasses to provide instance-specific default styles. Call
   * `super.defaultInstanceStyleRules()` to inherit and extend parent rules.
   *
   * All default rules run at lower priority than rules added via
   * `model.addStyleRules()`.
   */
  defaultInstanceStyleRules(): StyleRuleDescriptor[] {
    return [];
  }
}
