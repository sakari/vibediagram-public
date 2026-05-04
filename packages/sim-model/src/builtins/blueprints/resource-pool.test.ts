import { describe, it, expect } from "vitest";
import {
  Blueprint,
  component,
  createModel,
  distributions,
  InputNode,
  metrics,
} from "../../index";
import { ResourcePool } from "./resource-pool";
import { createEngine } from "@diagram/sim-default-engine";

/**
 * Builds a model with a ResourcePool wired to InputNodes, a Uniform distribution,
 * a Gauge, and a Summary. A driver Blueprint calls the provided `work` callback
 * during engineOnStart so tests can exercise use() sequences.
 *
 * Returns the engine controller and metric instances for assertions.
 */
function buildPoolModel(opts: {
  capacity: number;
  scalingExponent: number;
  latencyMin: number;
  latencyMax: number;
  duration: number;
  seed?: string;
  work: (
    pool: ResourcePool,
    ctx: { engine: Blueprint["engine"] },
  ) => Promise<void> | void;
}) {
  const model = createModel();

  const capacityInput = model.create("capacity", InputNode, {
    kind: "number",
    defaultValue: opts.capacity,
    min: 1,
    max: 100,
    step: 1,
  });

  const scalingInput = model.create("scalingExponent", InputNode, {
    kind: "number",
    defaultValue: opts.scalingExponent,
    min: 0,
    max: 10,
    step: 0.1,
  });

  const latencyDist = model.create("latency", distributions.Uniform, {
    min: opts.latencyMin,
    max: opts.latencyMax,
  });

  const utilGauge = model.create<metrics.Gauge<"ratio">>(
    "utilization",
    metrics.Gauge,
    { unit: "ratio" },
  );

  const latencyMetrics = model.create<metrics.Summary<"duration">>(
    "latencyMetrics",
    metrics.Summary,
    { unit: "duration", buckets: [0.5, 0.9, 0.99], capacity: 1000 },
  );

  const concurrentGauge = model.create<metrics.Gauge<"count", "state">>(
    "concurrent",
    metrics.Gauge,
    { unit: "count" },
  );

  const pool = model.create("pool", ResourcePool, {
    capacity: capacityInput,
    scalingExponent: scalingInput,
    latency: latencyDist,
    utilization: utilGauge,
    concurrentRequests: concurrentGauge,
    latencyMetrics,
  });

  const workFn = opts.work;

  class Driver extends Blueprint {
    static params = { pool: component.ref(ResourcePool) };
    declare params: typeof Driver.params;
    engineOnStart() {
      void this.run();
    }
    async run() {
      await workFn(this.params.pool, { engine: this.engine });
    }
  }

  model.create("driver", Driver, { pool });

  const controller = createEngine(model, {
    seed: opts.seed ?? "test",
    duration: opts.duration,
  });

  return { controller, pool, utilGauge, latencyMetrics };
}

describe("ResourcePool defaults", () => {
  it("can be created without a thunk — all ref defaults auto-create nodes", async () => {
    const model = createModel();
    const pool = model.create("pool", ResourcePool);

    class Driver extends Blueprint {
      static params = { pool: component.ref(ResourcePool) };
      declare params: typeof Driver.params;
      engineOnStart() {
        void this.run();
      }
      async run() {
        const result = await this.params.pool.use(() => "ok" as const);
        expect(result).toBe("ok");
        this.engine.halt("done");
      }
    }

    model.create("driver", Driver, { pool });

    const controller = createEngine(model, { seed: "defaults", duration: 100 });
    await controller.run();

    // Verify auto-created nodes exist in the topology
    const names = controller.registrations.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "pool",
        "pool/capacity",
        "pool/latency",
        "pool/scalingExponent",
        "pool/utilization",
        "pool/concurrentRequests",
        "pool/latencyMetrics",
      ]),
    );
  });
});

describe("ResourcePool", () => {
  it("use returns the fn result when pool has capacity", async () => {
    let result: string | null | undefined;

    const { controller } = buildPoolModel({
      capacity: 2,
      scalingExponent: 1,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 1,
      work: async (pool, { engine }) => {
        result = await pool.use(() => "ok");
        engine.halt("done");
      },
    });

    await controller.run();
    expect(result).toBe("ok");
  });

  it("use returns null after timeout when pool is full", async () => {
    let secondResult: string | null | undefined;

    // With capacity=1 and base latency=0.001, the held slot's service
    // latency at 100% util is ~1s. The second use() with timeout=0.5 must
    // expire while queued.
    const { controller } = buildPoolModel({
      capacity: 1,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: async (pool, { engine }) => {
        // Fire-and-forget holder that occupies the slot for 5s of work.
        void pool.use(() => engine.timeout(5));
        // Yield so the holder is admitted before the next use() enqueues.
        await engine.timeout(0);
        secondResult = await pool.use(() => "ok", { timeout: 0.5 });
        engine.halt("done");
      },
    });

    await controller.run();
    expect(secondResult).toBeNull();
  });

  it("timeout covers service latency, not just queuing wait", async () => {
    let result: string | null | undefined;

    // Capacity 2, low base latency but the second slot lands at 100% util
    // because the first is already held → service latency ~10s, exceeding
    // the 0.5s timeout.
    const { controller } = buildPoolModel({
      capacity: 2,
      scalingExponent: 1,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 200,
      work: async (pool, { engine }) => {
        void pool.use(() => engine.timeout(50));
        await engine.timeout(0);
        result = await pool.use(() => "ok", { timeout: 0.5 });
        engine.halt("done");
      },
    });

    await controller.run();
    expect(result).toBeNull();
  });

  it("queued use() calls are served in FIFO order", async () => {
    const completionOrder: number[] = [];

    const { controller } = buildPoolModel({
      capacity: 1,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: async (pool, { engine }) => {
        // Three concurrent users. With capacity=1 and strict FIFO, they must
        // complete in the order they enqueued.
        const settled = Promise.all([
          pool.use(() => {
            completionOrder.push(1);
          }),
          pool.use(() => {
            completionOrder.push(2);
          }),
          pool.use(() => {
            completionOrder.push(3);
          }),
        ]);
        await settled;
        engine.halt("done");
      },
    });

    await controller.run();
    expect(completionOrder).toEqual([1, 2, 3]);
  });

  it("latency increases with utilization", async () => {
    // Compare latency observed in the Summary metric at low vs high utilization.
    // Low utilization run: 1 of 10 slots = 10%
    const { controller: c1, latencyMetrics: lm1 } = buildPoolModel({
      capacity: 10,
      scalingExponent: 1,
      latencyMin: 0.1,
      latencyMax: 0.1,
      duration: 10000,
      seed: "low-util",
      work: async (pool, { engine }) => {
        await pool.use(() => undefined);
        engine.halt("done");
      },
    });
    await c1.run();

    // High utilization run: hold 9 of 10 slots, then the 10th sees 100%.
    const { controller: c2, latencyMetrics: lm2 } = buildPoolModel({
      capacity: 10,
      scalingExponent: 1,
      latencyMin: 0.1,
      latencyMax: 0.1,
      duration: 10000,
      seed: "high-util",
      work: async (pool, { engine }) => {
        for (let i = 0; i < 9; i++) {
          void pool.use(() => engine.timeout(1000));
        }
        // Let the holders advance through admission and start their latency.
        await engine.timeout(0);
        await pool.use(() => undefined);
        engine.halt("done");
      },
    });
    await c2.run();

    // Extract the p99 latency (highest quantile = near-maximum observed value)
    const getP99 = (lm: metrics.Summary<"duration">): number => {
      const snaps = lm.metrics();
      for (const snap of snaps) {
        if (snap.value.type === "summary" && snap.labels.quantile === "0.99") {
          return snap.value.value;
        }
      }
      return 0;
    };

    const lowP99 = getP99(lm1);
    const highP99 = getP99(lm2);

    // At 10% util: scaled = 0.1 / (1-0.1)^1 = ~0.111
    // At near-100% util (clamped 0.999): scaled = 0.1 / 0.001 = 100
    expect(lowP99).toBeGreaterThan(0);
    expect(highP99).toBeGreaterThan(lowP99 * 3);
  });

  it("utilization gauge tracks active/capacity", async () => {
    let gaugeWhileHeld: number | undefined;
    let gaugeAfterRelease: number | undefined;

    const { controller, utilGauge } = buildPoolModel({
      capacity: 2,
      scalingExponent: 1,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 10,
      work: async (pool, { engine }) => {
        await pool.use(() => {
          // Inside fn: active=1, capacity=2, util=0.5
          for (const snap of utilGauge.metrics()) {
            if (snap.value.type === "gauge") {
              gaugeWhileHeld = snap.value.value;
            }
          }
        });

        // After use() returns: active=0, capacity=2, util=0
        for (const snap of utilGauge.metrics()) {
          if (snap.value.type === "gauge") {
            gaugeAfterRelease = snap.value.value;
          }
        }

        engine.halt("done");
      },
    });

    await controller.run();
    expect(gaugeWhileHeld).toBe(0.5);
    expect(gaugeAfterRelease).toBe(0);
  });

  it("scaling exponent k affects latency curve", async () => {
    // Acquire at 90% utilization with k=1
    const { controller: c1, latencyMetrics: lm1 } = buildPoolModel({
      capacity: 10,
      scalingExponent: 1,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 10000,
      seed: "k-test",
      work: async (pool, { engine }) => {
        for (let i = 0; i < 8; i++) {
          void pool.use(() => engine.timeout(1000));
        }
        await engine.timeout(0);
        await pool.use(() => undefined);
        engine.halt("done");
      },
    });
    await c1.run();

    // Same scenario with k=2
    const { controller: c2, latencyMetrics: lm2 } = buildPoolModel({
      capacity: 10,
      scalingExponent: 2,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 10000,
      seed: "k-test",
      work: async (pool, { engine }) => {
        for (let i = 0; i < 8; i++) {
          void pool.use(() => engine.timeout(1000));
        }
        await engine.timeout(0);
        await pool.use(() => undefined);
        engine.halt("done");
      },
    });
    await c2.run();

    // Extract the p99 (highest quantile) to capture the last use's latency
    const getP99 = (lm: metrics.Summary<"duration">): number => {
      const snaps = lm.metrics();
      for (const snap of snaps) {
        if (snap.value.type === "summary" && snap.labels.quantile === "0.99") {
          return snap.value.value;
        }
      }
      return 0;
    };

    const timeK1 = getP99(lm1);
    const timeK2 = getP99(lm2);

    // At 90% util: k=1 gives 0.01/(0.1)^1 = 0.1, k=2 gives 0.01/(0.1)^2 = 1.0
    expect(timeK1).toBeGreaterThan(0);
    expect(timeK2).toBeGreaterThan(timeK1 * 2);
  });

  it("timed use succeeds when latency fits within timeout", async () => {
    let result: string | null | undefined;

    // Capacity 10, first use at 10% util → latency ≈ 0.0011s. Timeout 5s
    // is plenty.
    const { controller } = buildPoolModel({
      capacity: 10,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: async (pool, { engine }) => {
        result = await pool.use(() => "ok", { timeout: 5 });
        engine.halt("done");
      },
    });

    await controller.run();
    expect(result).toBe("ok");
  });

  it("slot is released when fn throws", async () => {
    let secondResult: string | null | undefined;
    let thrown: unknown;

    const { controller, utilGauge } = buildPoolModel({
      capacity: 1,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: async (pool, { engine }) => {
        try {
          await pool.use(() => {
            throw new Error("boom");
          });
        } catch (e) {
          thrown = e;
        }
        // If the slot leaked, this second use() would block forever.
        secondResult = await pool.use(() => "ok");
        engine.halt("done");
      },
    });

    await controller.run();
    expect(thrown).toBeInstanceOf(Error);
    expect(secondResult).toBe("ok");
    for (const snap of utilGauge.metrics()) {
      if (snap.value.type === "gauge") {
        expect(snap.value.value).toBe(0);
      }
    }
  });

  it("utilization gauge stays <= 1.0 even when capacity drops below active", async () => {
    // Records every value the pool publishes to the utilization gauge so
    // we can assert on intermediate states that user code can't otherwise
    // observe (e.g. the moment between two release()s).
    class RecordingGauge extends metrics.Gauge<"ratio"> {
      values: number[] = [];
      set(labels: Record<never, string>, value: number): void {
        this.values.push(value);
        super.set(labels, value);
      }
    }

    const model = createModel();
    const capacityInput = model.create("capacity", InputNode, {
      kind: "number",
      defaultValue: 4,
      min: 1,
      max: 100,
      step: 1,
    });
    const utilGauge = model.create<RecordingGauge>(
      "utilization",
      RecordingGauge,
      { unit: "ratio" },
    );
    const pool = model.create("pool", ResourcePool, {
      capacity: capacityInput,
      utilization: utilGauge,
    });

    class Driver extends Blueprint {
      static params = { pool: component.ref(ResourcePool) };
      declare params: typeof Driver.params;
      engineOnStart() {
        void this.run();
      }
      async run() {
        // Hold all 4 slots with staggered work durations so releases happen
        // at distinct simulation times.
        const holders: Promise<unknown>[] = [];
        for (let i = 0; i < 4; i++) {
          holders.push(
            this.params.pool.use(() => this.engine.timeout(0.01 * (i + 1))),
          );
        }
        await this.engine.timeout(0);
        // Halve capacity while all 4 slots are still held — the next
        // release() would compute 3/2 = 1.5 without a clamp.
        capacityInput.value = 2;
        await Promise.all(holders);
        this.engine.halt("done");
      }
    }

    model.create("driver", Driver, { pool });

    const controller = createEngine(model, {
      seed: "shrink",
      duration: 200,
    });
    await controller.run();

    expect(utilGauge.values.length).toBeGreaterThan(0);
    for (const v of utilGauge.values) {
      expect(v).toBeLessThanOrEqual(1.0);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
