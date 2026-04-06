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
 * - utilization = active / capacity (clamped to [0, 1))
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
 * Waiters are served in FIFO order: the longest-waiting caller gets the
 * next released slot.
 */

import { Blueprint } from "../../blueprint";
import { Distribution } from "../../distribution";
import { Gauge, Summary } from "../../metric";
import { InputNode } from "../../input";
import { component, type DefaultFactory } from "../../sentinel";
import { Exponential } from "../distributions/exponential";

/**
 * Default factory that creates an InputNode with the given params.
 * Used by ResourcePool sentinel defaults to auto-create inputs when
 * the caller omits them from the thunk.
 */
function inputFactory(
  params: () => {
    kind: string;
    defaultValue: number;
    min: number;
    max: number;
    step: number;
  },
): DefaultFactory {
  return (m, name) => m.create(name, InputNode, params);
}

export class ResourcePool extends Blueprint {
  params = {
    capacity: component.ref(
      InputNode,
      inputFactory(() => ({
        kind: "number",
        defaultValue: 10,
        min: 1,
        max: 100,
        step: 1,
      })),
    ),
    latency: component.ref(Distribution, (m, name) =>
      m.create(name, Exponential, () => ({ mean: 0.005 })),
    ),
    scalingExponent: component.ref(
      InputNode,
      inputFactory(() => ({
        kind: "number",
        defaultValue: 1,
        min: 0.1,
        max: 5,
        step: 0.1,
      })),
    ),
    utilization: component.ref(Gauge, (m, name) =>
      m.create(name, Gauge, () => ({ unit: "ratio" })),
    ),
    concurrentRequests: component.ref(Gauge, (m, name) =>
      m.create(name, Gauge),
    ),
    latencyMetrics: component.ref(Summary, (m, name) =>
      m.create(name, Summary),
    ),
  };

  private active = 0;
  private waitQueue: Array<() => void> = [];

  /** Update the concurrentRequests gauge for both active and waiting states. */
  private updateConcurrentRequests(): void {
    this.params.concurrentRequests.set({ state: "active" }, this.active);
    this.params.concurrentRequests.set(
      { state: "waiting" },
      this.waitQueue.length,
    );
  }

  /**
   * Acquire a resource from the pool.
   *
   * If a slot is free, reserves it immediately. If the pool is full, waits
   * for a slot to be released. If `timeout` is provided and fires before
   * the resource is acquired *and* the service latency completes, returns
   * false without reserving.
   *
   * The timeout covers the entire acquire lifecycle: both the queuing wait
   * and the service latency delay. This matches real-world semantics where
   * a caller's deadline applies to the total operation time.
   *
   * Once a slot is reserved, samples latency from the distribution, scales
   * it by the power-law formula, and advances simulation time. Returns true
   * when the full service delay has elapsed.
   */
  async acquire(timeout?: number): Promise<boolean> {
    const cap = this.params.capacity.value;
    const start = this.engine.now();

    // When no timeout, use a promise that never resolves so the same
    // Promise.race logic works for both paths.
    const timeoutPromise =
      timeout !== undefined
        ? this.engine.timeout(timeout).then(() => "timeout" as const)
        : new Promise<"timeout">(() => {});

    // Step 1: wait for a free slot if at capacity.
    if (this.active >= cap) {
      const waiter = { cb: (): void => {} };
      const result = await Promise.race([
        new Promise<"acquired">((resolve) => {
          waiter.cb = () => {
            resolve("acquired");
          };
          this.waitQueue.push(waiter.cb);
          this.updateConcurrentRequests();
        }),
        timeoutPromise,
      ]);
      if (result === "timeout") {
        // Remove ourselves from the wait queue if still queued
        const idx = this.waitQueue.indexOf(waiter.cb);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        this.updateConcurrentRequests();
        this.params.latencyMetrics.observe({}, this.engine.now() - start);
        return false;
      }
      // We were woken — waiting count decreased (callback was shift()ed by release)
      this.updateConcurrentRequests();
    }

    // Reserve the slot.
    this.active++;
    const utilization = this.active / cap;
    this.params.utilization.set({}, utilization);
    this.updateConcurrentRequests();

    // Step 2: service latency scaled by power-law: base / (1 - utilization)^k
    const base = this.params.latency.draw();
    const k = this.params.scalingExponent.value;
    const clampedUtil = Math.min(utilization, 0.999);
    const scaled = Math.max(0, base / Math.pow(1 - clampedUtil, k));

    const latencyResult = await Promise.race([
      this.engine.timeout(scaled).then(() => "done" as const),
      timeoutPromise,
    ]);

    const elapsed = this.engine.now() - start;
    this.params.latencyMetrics.observe({}, elapsed);

    if (latencyResult === "timeout") {
      // Release the slot — we couldn't complete within the timeout.
      this.active--;
      this.params.utilization.set({}, this.active / cap);
      this.updateConcurrentRequests();
      const next = this.waitQueue.shift();
      if (next) next();
      return false;
    }

    return true;
  }

  /**
   * Release a resource back to the pool. Decrements active count,
   * updates utilization gauge, and wakes the next queued waiter (FIFO).
   */
  release(): void {
    if (this.active <= 0) return;
    this.active--;
    const cap = this.params.capacity.value;
    this.params.utilization.set({}, this.active / cap);

    // Wake the next waiter (FIFO order).
    const next = this.waitQueue.shift();
    if (next) next();
    this.updateConcurrentRequests();
  }
}
