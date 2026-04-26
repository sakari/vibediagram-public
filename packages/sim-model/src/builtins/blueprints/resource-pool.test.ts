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
 * during engineOnStart so tests can exercise acquire/release sequences.
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
        const ok = await this.params.pool.acquire();
        expect(ok).toBe(true);
        this.params.pool.release();
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
  it("acquire succeeds when pool has capacity", async () => {
    let acquired: boolean | undefined;

    const { controller } = buildPoolModel({
      capacity: 2,
      scalingExponent: 1,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 1,
      work: async (pool, { engine }) => {
        acquired = await pool.acquire();
        engine.halt("done");
      },
    });

    await controller.run();
    expect(acquired).toBe(true);
  });

  it("acquire blocks and returns false after timeout when pool is full", async () => {
    let secondResult: boolean | undefined;

    // With capacity=1 and base latency=0.001, at 100% util (clamped 0.999):
    // scaled = 0.001 / (1-0.999)^1 = 0.001/0.001 = 1.0
    // First acquire completes at ~t=1. Second acquire timeout of 0.5
    // fires at ~t=1.5, well within duration=50.
    const { controller } = buildPoolModel({
      capacity: 1,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: async (pool, { engine }) => {
        await pool.acquire();
        // Pool is full -- second acquire with timeout should return false
        secondResult = await pool.acquire(0.5);
        engine.halt("done");
      },
    });

    await controller.run();
    expect(secondResult).toBe(false);
  });

  it("timeout covers service latency, not just queuing wait", async () => {
    let result: boolean | undefined;

    // Capacity 2, low base latency but high scaling at near-100% util.
    // Fill one slot, then acquire second with a short timeout.
    // Slot 2 at 100% util → latency = 0.01 / 0.001 = 10s, but timeout is 0.5s.
    // The timeout should fire during the service latency phase and return false.
    const { controller } = buildPoolModel({
      capacity: 2,
      scalingExponent: 1,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 200,
      work: async (pool, { engine }) => {
        // Fill first slot (50% util, fast latency ~0.02s)
        await pool.acquire();
        // Second slot available immediately (no queuing wait), but service
        // latency at 100% util is ~10s, exceeding the 0.5s timeout.
        result = await pool.acquire(0.5);
        engine.halt("done");
      },
    });

    await controller.run();
    expect(result).toBe(false);
  });

  it("release wakes up a queued acquire", async () => {
    let secondAcquired: boolean | undefined;

    // Same latency math: first acquire at 100% util takes ~1.0s sim time.
    // driver.timeout(0.05) fires at ~1.05, release wakes second acquire,
    // second acquire latency fires, all within duration=50.
    const { controller } = buildPoolModel({
      capacity: 1,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: async (pool, { engine }) => {
        await pool.acquire();

        // Start a second acquire that will block (pool full)
        const secondPromise = pool.acquire();

        // Wait then release, which should wake the blocked acquire
        await engine.timeout(0.05);
        pool.release();

        secondAcquired = await secondPromise;
        engine.halt("done");
      },
    });

    await controller.run();
    expect(secondAcquired).toBe(true);
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
        // One acquire at 10% utilization
        await pool.acquire();
        pool.release();
        engine.halt("done");
      },
    });
    await c1.run();

    // High utilization run: acquire 10 of 10 slots = 100%
    const { controller: c2, latencyMetrics: lm2 } = buildPoolModel({
      capacity: 10,
      scalingExponent: 1,
      latencyMin: 0.1,
      latencyMax: 0.1,
      duration: 10000,
      seed: "high-util",
      work: async (pool, { engine }) => {
        // Fill 9 of 10 slots first (fire-and-forget so they acquire concurrently)
        for (let i = 0; i < 9; i++) {
          void pool.acquire();
        }
        // Let those acquires settle through the event queue
        await engine.timeout(0);
        // Acquire the 10th slot at near-100% utilization
        await pool.acquire();
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

    // Low-util run has 1 observation; high-util run has 10 with the last
    // at near-100% utilization. The p99 captures the highest observed latency.
    const lowP99 = getP99(lm1);
    const highP99 = getP99(lm2);

    // At 10% util: scaled = 0.1 / (1-0.1)^1 = ~0.111
    // At near-100% util (clamped 0.999): scaled = 0.1 / 0.001 = 100
    expect(lowP99).toBeGreaterThan(0);
    expect(highP99).toBeGreaterThan(lowP99 * 3);
  });

  it("utilization gauge tracks active/capacity", async () => {
    let gaugeAfterAcquire: number | undefined;
    let gaugeAfterRelease: number | undefined;

    const { controller, utilGauge } = buildPoolModel({
      capacity: 2,
      scalingExponent: 1,
      latencyMin: 0.01,
      latencyMax: 0.01,
      duration: 10,
      work: async (pool, { engine }) => {
        await pool.acquire();

        // Read gauge after acquire: active=1, capacity=2, util=0.5
        for (const snap of utilGauge.metrics()) {
          if (snap.value.type === "gauge") {
            gaugeAfterAcquire = snap.value.value;
          }
        }

        pool.release();

        // Read gauge after release: active=0, capacity=2, util=0
        for (const snap of utilGauge.metrics()) {
          if (snap.value.type === "gauge") {
            gaugeAfterRelease = snap.value.value;
          }
        }

        engine.halt("done");
      },
    });

    await controller.run();
    expect(gaugeAfterAcquire).toBe(0.5);
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
        // Fill 8 slots via fire-and-forget
        for (let i = 0; i < 8; i++) {
          void pool.acquire();
        }
        await engine.timeout(0);
        // 9th slot at 90% utilization
        await pool.acquire();
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
          void pool.acquire();
        }
        await engine.timeout(0);
        await pool.acquire();
        engine.halt("done");
      },
    });
    await c2.run();

    // Extract the p99 (highest quantile) to capture the last acquire's latency
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

  it("timed acquire succeeds when latency fits within timeout", async () => {
    let result: boolean | undefined;

    // Capacity 10, first acquire at 10% util → latency = 0.001 / (0.9)^1 ≈ 0.0011s
    // Timeout of 5s is plenty. Should return true.
    const { controller } = buildPoolModel({
      capacity: 10,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: async (pool, { engine }) => {
        result = await pool.acquire(5);
        pool.release();
        engine.halt("done");
      },
    });

    await controller.run();
    expect(result).toBe(true);
  });

  it("release when already at zero is a no-op", async () => {
    const { controller, utilGauge } = buildPoolModel({
      capacity: 2,
      scalingExponent: 1,
      latencyMin: 0.001,
      latencyMax: 0.001,
      duration: 50,
      work: (_pool, { engine }) => {
        // Release without acquiring — should not throw or go negative
        _pool.release();
        _pool.release();
        engine.halt("done");
      },
    });

    await controller.run();
    // Gauge should still be 0 (not negative)
    for (const snap of utilGauge.metrics()) {
      if (snap.value.type === "gauge") {
        expect(snap.value.value).toBe(0);
      }
    }
  });
});
