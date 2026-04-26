import { describe, it, expect } from "vitest";
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
// Blueprint implementations (self-contained in test file)
// ---------------------------------------------------------------------------

class ResourcePool extends Blueprint {
  static params = { capacity: component.capacity() };
  declare params: typeof ResourcePool.params;
  private activeCount = 0;
  private waitQueue: Array<() => void> = [];
  slotAcquiredAt!: Float64Array;

  engineOnStart() {
    const { capacity } = this.params;
    this.slotAcquiredAt = new Float64Array(capacity);
  }

  protected delayForUtilization(u: number): number {
    return 0.01 / (1 - Math.min(u, 0.99));
  }

  async acquire() {
    const capacity = this.params.capacity;
    if (this.activeCount >= capacity) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }
    this.activeCount++;
    const u = this.activeCount / capacity;
    await this.engine.timeout(this.delayForUtilization(u));
  }

  release() {
    if (this.activeCount <= 0) return;
    this.activeCount--;
    const next = this.waitQueue.shift();
    if (next) next();
  }
}

class Database extends Blueprint {
  static params = { pool: component.ref(ResourcePool) };
  declare params: typeof Database.params;
  async query() {
    const { pool } = this.params;
    await pool.acquire();
    pool.release();
    return "ok";
  }
}

abstract class Server extends Blueprint {
  abstract request(): Promise<unknown>;
}

class HttpServer extends Server {
  static params = {
    requests: component.ref(metrics.Counter<"count", "result">),
    database: component.ref(Database),
    timeout: component.duration(),
  };
  declare params: typeof HttpServer.params;

  async request() {
    const { requests, database, timeout } = this.params;
    const result = await Promise.race([
      database.query().then(() => "success" as const),
      this.engine.timeout(timeout).then(() => "timeout" as const),
    ]);
    requests.increment({ result });
    return result;
  }
}

class TrafficGenerator extends Blueprint {
  static params = {
    rate: component.rate(),
    target: component.ref(Server),
  };
  declare params: typeof TrafficGenerator.params;

  engineOnStart() {
    void this.generateTraffic();
  }

  private async generateTraffic() {
    const { rate, target } = this.params;
    const interval = 1 / rate;
    for (;;) {
      await this.engine.timeout(interval);
      void target.request();
    }
  }
}

// ---------------------------------------------------------------------------
// Model wiring helper
// ---------------------------------------------------------------------------

function buildModel() {
  const model = createModel();

  const pool = model.create("pool", ResourcePool, { capacity: 3 });
  const database = model.create("database", Database, { pool });
  const requests = model.create<metrics.Counter<"count", "result">>(
    "requests",
    metrics.Counter,
    {
      unit: "count",
    },
  );
  const httpServer = model.create("httpServer", HttpServer, {
    requests,
    database,
    timeout: 0.5,
  });
  model.create("trafficGenerator", TrafficGenerator, {
    rate: 100,
    target: httpServer,
  });

  return { model, pool };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("integration", () => {
  describe("[integration-runs]", () => {
    it("simulation completes without errors", async () => {
      const { model } = buildModel();
      const controller = createEngine(model, {
        seed: "test",
        duration: 10,
      });
      await expect(controller.run()).resolves.toBeUndefined();
    });
  });

  describe("[integration-metrics]", () => {
    it("requests Counter has non-zero counts for success and timeout", async () => {
      const { model } = buildModel();
      const controller = createEngine(model, {
        seed: "test",
        duration: 10,
      });
      await controller.run();

      const snap = controller.snapshot();
      const successSnap = snap.find((s) => s.labels.result === "success");
      const timeoutSnap = snap.find((s) => s.labels.result === "timeout");

      expect(successSnap).toBeDefined();
      expect(timeoutSnap).toBeDefined();

      const successValue = successSnap!.value;
      const timeoutValue = timeoutSnap!.value;

      expect(successValue.type).toBe("counter");
      expect(timeoutValue.type).toBe("counter");

      if (successValue.type !== "counter" || timeoutValue.type !== "counter") {
        throw new Error("Expected counter metrics");
      }

      expect(successValue.value).toBeGreaterThan(0);
      expect(timeoutValue.value).toBeGreaterThan(0);

      const total = successValue.value + timeoutValue.value;
      expect(total).toBeGreaterThan(500);
    });
  });

  describe("[integration-deterministic]", () => {
    it("same seed produces identical Counter values", async () => {
      const runOnce = async () => {
        const { model } = buildModel();
        const controller = createEngine(model, {
          seed: "test",
          duration: 10,
        });
        await controller.run();
        return controller.snapshot();
      };

      const snapA = await runOnce();
      const snapB = await runOnce();

      expect(snapA).toEqual(snapB);
    });
  });

  describe("[integration-topology]", () => {
    it("model registrations contain all expected nodes", () => {
      const { model } = buildModel();
      const names = model.registrations.map((r) => r.name);

      expect(names).toContain("httpServer");
      expect(names).toContain("database");
      expect(names).toContain("pool");
      expect(names).toContain("requests");
      expect(names).toContain("trafficGenerator");
      expect(names).toHaveLength(5);
    });
  });

  describe("[integration-distribution-wiring]", () => {
    it("distribution has engine wired after engine creation", () => {
      const model = createModel();
      const dist = model.create("latency", distributions.Exponential, {
        mean: 0.1,
      });
      createEngine(model, { seed: "dist-test", duration: 1 });

      expect(dist.engine).toBeDefined();
      expect(typeof dist.engine.random).toBe("function");
    });

    it("distribution draw is deterministic with same seed", () => {
      const run = () => {
        const model = createModel();
        const dist = model.create("latency", distributions.Exponential, {
          mean: 0.5,
        });
        createEngine(model, { seed: "det-test", duration: 1 });
        return Array.from({ length: 20 }, () => dist.draw());
      };
      expect(run()).toEqual(run());
    });

    it("distribution appears in model registrations", () => {
      const model = createModel();
      model.create("latency", distributions.Exponential, { mean: 0.1 });
      const names = model.registrations.map((r) => r.name);
      expect(names).toContain("latency");
    });

    it("blueprint can use distribution in engineOnStart", async () => {
      const model = createModel();
      const dist = model.create("delay", distributions.Exponential, {
        mean: 0.1,
      });

      class Worker extends Blueprint {
        static params = { delay: component.ref(distributions.Exponential) };
        declare params: typeof Worker.params;
        draws: number[] = [];
        engineOnStart() {
          this.draws.push(this.params.delay.draw());
          this.draws.push(this.params.delay.draw());
        }
      }

      const worker = model.create("worker", Worker, { delay: dist });
      const controller = createEngine(model, {
        seed: "use-test",
        duration: 1,
      });
      await controller.run();

      expect(worker.draws).toHaveLength(2);
      expect(worker.draws[0]).toBeGreaterThan(0);
      expect(worker.draws[1]).toBeGreaterThan(0);
    });
  });

  describe("[integration-engineOnStart-order]", () => {
    it("pool slotAcquiredAt is initialized after run", async () => {
      const { model, pool } = buildModel();
      const controller = createEngine(model, {
        seed: "test",
        duration: 10,
      });
      await controller.run();

      expect(pool.slotAcquiredAt).toBeInstanceOf(Float64Array);
      expect(pool.slotAcquiredAt.length).toBe(3);
    });
  });

  describe("[integration-latency-blueprint]", () => {
    function buildLatencyModel() {
      const model = createModel();
      const dist = model.create("dist", distributions.Exponential, {
        mean: 0.05,
      });
      const latencyMetrics = model.create<metrics.Summary>(
        "latencyMetrics",
        metrics.Summary,
        {
          unit: "duration",
          buckets: [0.5, 0.9, 0.99],
          capacity: 1000,
        },
      );
      const link = model.create("link", blueprints.LatencyBlueprint, {
        latency: dist,
        metrics: latencyMetrics,
      });

      class Caller extends Blueprint {
        static params = { link: component.ref(blueprints.LatencyBlueprint) };
        declare params: typeof Caller.params;
        engineOnStart() {
          void this.work();
        }
        async work() {
          for (;;) {
            await this.params.link.delay();
          }
        }
      }

      model.create("caller", Caller, { link });
      return { model };
    }

    it("LatencyBlueprint wired and records metrics after run", async () => {
      const { model } = buildLatencyModel();
      const controller = createEngine(model, {
        seed: "latency-test",
        duration: 1,
      });
      await controller.run();

      const snap = controller.snapshot();
      const latencySnaps = snap.filter((s) => s.unit === "duration");
      expect(latencySnaps.length).toBeGreaterThan(0);
      expect(latencySnaps[0].value.type).toBe("summary");
      expect(latencySnaps[0].value.value).toBeGreaterThan(0);
    });

    it("deterministic with same seed", async () => {
      const runOnce = async () => {
        const { model } = buildLatencyModel();
        const controller = createEngine(model, {
          seed: "latency-det",
          duration: 1,
        });
        await controller.run();
        return controller.snapshot();
      };

      const a = await runOnce();
      const b = await runOnce();
      expect(a).toEqual(b);
    });

    it("LatencyBlueprint appears in topology", () => {
      const { model } = buildLatencyModel();
      const names = model.registrations.map((r) => r.name);
      expect(names).toContain("link");
      expect(names).toContain("dist");
      expect(names).toContain("latencyMetrics");
      expect(names).toContain("caller");
    });
  });
});
