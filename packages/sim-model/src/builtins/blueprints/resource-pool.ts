/**
 * Builtin resource pool blueprint: models a bounded pool of resources
 * (connections, threads, workers) with utilization-dependent latency.
 *
 * Latency follows a power-law scaling model (generalized M/M/1):
 *
 *   scaled_latency = base_sample / (1 - utilization)^k
 *
 * Where:
 * - base_sample is drawn from the pluggable latency Distribution wired
 *   via params.latency (e.g. Exponential, Uniform, LogNormal — any
 *   Distribution subclass)
 * - utilization = active / capacity (clamped to [0, 1) for the formula)
 * - k = scaling exponent (params.scalingExponent.value, default 1.0)
 *
 * When k=1 this is the classic M/M/1 queuing model from queuing theory
 * (Kendall notation), predicting mean response time grows as 1/(1-ρ).
 * See: Gross, D. et al. "Fundamentals of Queueing Theory" (Wiley, 4th ed.)
 *
 * - k=1: M/M/1 — connection pools, databases, thread pools
 * - k>1: steeper degradation — GC pressure, lock contention
 * - k<1: gentler curve — systems with effective backpressure
 *
 * Admission is strict FIFO: every caller enqueues, no fast lane. Capacity
 * is read live on every admission decision, so changing the capacity input
 * at runtime takes effect immediately and the bound `active <= capacity` is
 * never violated.
 */

import { Blueprint } from "../../blueprint";
import { Distribution } from "../../distribution";
import { Gauge, Summary } from "../../metric";
import { InputNode } from "../../input";
import { component, type DefaultFactory } from "../../sentinel";
import { Exponential } from "../distributions/exponential";
import { AsyncSemaphore } from "./async-semaphore";

/**
 * Default factory that creates an InputNode with the given params.
 * Used by ResourcePool sentinel defaults to auto-create inputs when
 * the caller omits them.
 */
function inputFactory(params: {
  kind: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}): DefaultFactory {
  return (m, name) => m.create(name, InputNode, params);
}

export class ResourcePool extends Blueprint {
  static params = {
    capacity: component.ref(
      InputNode,
      inputFactory({
        kind: "number",
        defaultValue: 10,
        min: 1,
        max: 100,
        step: 1,
      }),
    ),
    latency: component.ref(Distribution, (m, name) =>
      m.create(name, Exponential, { mean: 0.005 }),
    ),
    scalingExponent: component.ref(
      InputNode,
      inputFactory({
        kind: "number",
        defaultValue: 1,
        min: 0.1,
        max: 5,
        step: 0.1,
      }),
    ),
    utilization: component.ref(Gauge, (m, name) =>
      m.create(name, Gauge, { unit: "ratio" }),
    ),
    concurrentRequests: component.ref(Gauge, (m, name) =>
      m.create(name, Gauge),
    ),
    latencyMetrics: component.ref(Summary, (m, name) =>
      m.create(name, Summary),
    ),
  };

  declare params: typeof ResourcePool.params;

  private sem = new AsyncSemaphore(() => this.params.capacity.value);

  /**
   * Run `fn` while holding a slot in the pool.
   *
   * The caller enqueues, waits for admission (strict FIFO), then incurs
   * the utilization-scaled service latency before `fn` runs. The slot is
   * released automatically when `fn` settles, even if it throws.
   *
   * If `timeout` is provided and fires before `fn` starts running (i.e.
   * during the queue wait or service latency), the call returns `null`
   * without invoking `fn`. The timeout covers the entire pre-`fn`
   * lifecycle, matching real-world deadline semantics.
   */
  async use<T>(
    fn: () => Promise<T> | T,
    opts?: { timeout?: number },
  ): Promise<T | null> {
    const start = this.engine.now();
    const timeout = opts?.timeout;
    const timeoutPromise =
      timeout !== undefined
        ? this.engine.timeout(timeout).then(() => "timeout" as const)
        : new Promise<"timeout">(() => {});

    const ticket = this.sem.acquire();
    this.publishMetrics();

    const admitResult = await Promise.race([
      ticket.admitted.then(() => "admitted" as const),
      timeoutPromise,
    ]);

    if (admitResult === "timeout" && ticket.cancel()) {
      this.publishMetrics();
      this.params.latencyMetrics.observe({}, this.engine.now() - start);
      return null;
    }

    // Either admitted normally, or timeout fired but admission already won
    // the race — in the latter case we hold a real slot and must release.
    this.publishMetrics();

    const cap = this.params.capacity.value;
    const u = Math.min(this.sem.inUse / cap, 0.999);
    const k = this.params.scalingExponent.value;
    const base = this.params.latency.draw();
    const scaled = Math.max(0, base / Math.pow(1 - u, k));

    const latencyResult = await Promise.race([
      this.engine.timeout(scaled).then(() => "done" as const),
      timeoutPromise,
    ]);

    if (latencyResult === "timeout") {
      this.sem.release();
      this.publishMetrics();
      this.params.latencyMetrics.observe({}, this.engine.now() - start);
      return null;
    }

    try {
      return await fn();
    } finally {
      this.sem.release();
      this.publishMetrics();
      this.params.latencyMetrics.observe({}, this.engine.now() - start);
    }
  }

  private publishMetrics(): void {
    const cap = this.params.capacity.value;
    // Clamp to [0, 1]: if capacity was reduced below the current active count,
    // the unclamped ratio exceeds 1, which is meaningless for "fraction of
    // capacity in use". The overcommit is still observable via concurrentRequests.
    this.params.utilization.set({}, Math.min(this.sem.inUse / cap, 1));
    this.params.concurrentRequests.set({ state: "active" }, this.sem.inUse);
    this.params.concurrentRequests.set({ state: "waiting" }, this.sem.queued);
  }
}
