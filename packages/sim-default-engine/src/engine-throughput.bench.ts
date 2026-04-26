import { bench, describe } from "vitest";
import {
  Blueprint,
  distributions,
  metrics,
  blueprints,
  component,
  createModel,
} from "@diagram/sim-model";
import { createEngine } from "./create-engine";

// ---------------------------------------------------------------------------
// Inline model (avoids circular dep with sim-examples)
// ---------------------------------------------------------------------------

class Pool extends Blueprint {
  static params = {
    capacity: component.capacity(),
    utilization: component.ref(metrics.Gauge),
  };
  declare params: typeof Pool.params;
  count = 0;

  acquire(): boolean {
    if (this.count >= this.params.capacity) return false;
    this.count++;
    this.params.utilization.set({}, this.count / this.params.capacity);
    return true;
  }

  release(): void {
    if (this.count > 0) this.count--;
    this.params.utilization.set({}, this.count / this.params.capacity);
  }

  engineOnStart() {}
}

class DB extends Blueprint {
  static params = {
    pool: component.ref(Pool),
    qps: component.ref(metrics.Counter),
    link: component.ref(blueprints.LatencyBlueprint),
  };
  declare params: typeof DB.params;

  engineOnStart() {
    void this.generateQueries();
  }

  async generateQueries() {
    for (;;) {
      await this.engine.timeout(1 / 30);
      void this.handleQuery();
    }
  }

  async handleQuery() {
    if (!this.params.pool.acquire()) return;
    const utilization =
      this.params.pool.count / this.params.pool.params.capacity;
    await this.params.link.delay(utilization);
    this.params.qps.increment({});
    this.params.pool.release();
  }
}

function buildRealisticModel(duration: number) {
  const model = createModel();
  const utilization = model.create<metrics.Gauge<"ratio">>(
    "utilization",
    metrics.Gauge,
    {
      unit: "ratio",
    },
  );
  const qps = model.create<metrics.Counter<"count">>("qps", metrics.Counter, {
    unit: "count",
  });
  model.create<metrics.Summary<"duration">>("latency", metrics.Summary, {
    unit: "duration",
    buckets: [0.5, 0.9, 0.99],
    capacity: 1000,
  });
  const dist = model.create("dist", distributions.Exponential, {
    mean: 0.005,
  });
  const latency = model.create<metrics.Summary<"duration">>(
    "link-latency",
    metrics.Summary,
    {
      unit: "duration",
      buckets: [0.5, 0.9, 0.99],
      capacity: 1000,
    },
  );
  const link = model.create("link", blueprints.LatencyBlueprint, {
    latency: dist,
    metrics: latency,
  });
  const pool = model.create("pool", Pool, {
    capacity: 20,
    utilization,
  });
  model.create("db", DB, {
    pool,
    qps,
    link,
  });
  return { model, duration };
}

// ---------------------------------------------------------------------------
// Minimal model: tight timeout loop measuring raw engine overhead
// ---------------------------------------------------------------------------

class Ticker extends Blueprint {
  engineOnStart() {
    void this.tick();
  }

  async tick() {
    for (;;) {
      await this.engine.timeout(0.001);
    }
  }
}

function buildMinimalModel(duration: number) {
  const model = createModel();
  model.create("ticker", Ticker, {});
  return { model, duration };
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("Engine throughput - realistic model", () => {
  bench("10s simulated time", async () => {
    const { model, duration } = buildRealisticModel(10);
    const controller = createEngine(model, { seed: "bench-10s", duration });
    await controller.run();
  });

  bench("60s simulated time", async () => {
    const { model, duration } = buildRealisticModel(60);
    const controller = createEngine(model, { seed: "bench-60s", duration });
    await controller.run();
  });
});

describe("Engine throughput - minimal model", () => {
  bench("10s simulated time (tight loop)", async () => {
    const { model, duration } = buildMinimalModel(10);
    const controller = createEngine(model, { seed: "bench-min", duration });
    await controller.run();
  });
});
