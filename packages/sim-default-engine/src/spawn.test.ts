import { describe, it, expect, vi } from "vitest";
import { Blueprint, metrics, component, createModel } from "@diagram/sim-model";
import { createEngine } from "./create-engine";

class Worker extends Blueprint {
  static params = {
    jobsProcessed: component.ref(metrics.Counter),
  };
  declare params: typeof Worker.params;

  engineOnStart() {
    void this.processJobs();
  }

  async processJobs() {
    for (let i = 0; i < 3; i++) {
      await this.engine.timeout(0.1);
      this.params.jobsProcessed.increment({});
    }
  }
}

class Spawner extends Blueprint {
  static params = {
    workerCount: component.ref(metrics.Gauge),
  };
  declare params: typeof Spawner.params;

  private spawnIndex = 0;

  engineOnStart() {
    void this.spawnLoop();
  }

  async spawnLoop() {
    for (let i = 0; i < 3; i++) {
      await this.engine.timeout(1);
      this.spawnIndex++;
      const idx = this.spawnIndex;

      const counter = this.engine.spawn(
        `worker-${String(idx)}-jobs`,
        metrics.Counter,
        { unit: "count" as const },
      );

      this.engine.spawn(`worker-${String(idx)}`, Worker, {
        jobsProcessed: counter,
      });

      this.params.workerCount.set({}, this.spawnIndex);
    }
  }
}

describe("[spawn-dynamic]", () => {
  it("engine.spawn creates new registrations during simulation", async () => {
    const model = createModel();
    const workerCount = model.create<metrics.Gauge<"count">>(
      "workerCount",
      metrics.Gauge,
      { unit: "count" },
    );
    model.create("spawner", Spawner, { workerCount });

    const engine = createEngine(model, { seed: "spawn-test", duration: 5 });

    expect(engine.registrations).toHaveLength(2);

    await engine.run();

    // 2 static + 3 workers + 3 counters = 8
    expect(engine.registrations).toHaveLength(8);
  });

  it("onTopologyChange callback fires when nodes are spawned", async () => {
    const model = createModel();
    const workerCount = model.create<metrics.Gauge<"count">>(
      "workerCount",
      metrics.Gauge,
      { unit: "count" },
    );
    model.create("spawner", Spawner, { workerCount });

    let callCount = 0;
    const engine = createEngine(model, {
      seed: "spawn-test-cb",
      duration: 5,
      onTopologyChange: () => {
        callCount++;
      },
    });

    await engine.run();

    // Should have been called at least once per spawn batch
    expect(callCount).toBeGreaterThan(0);
    // Consumer can query engine.registrations to get current state
    expect(engine.registrations).toHaveLength(8);
  });

  it("dynamically spawned workers produce metric snapshots", async () => {
    const model = createModel();
    const workerCount = model.create<metrics.Gauge<"count">>(
      "workerCount",
      metrics.Gauge,
      { unit: "count" },
    );
    model.create("spawner", Spawner, { workerCount });

    const engine = createEngine(model, { seed: "spawn-metrics", duration: 5 });
    await engine.run();

    const snapshots = engine.snapshot();
    // workerCount gauge + 3 worker counters = at least 4 snapshots
    expect(snapshots.length).toBeGreaterThanOrEqual(4);
  });

  it("spawned Blueprint gets a working engine facade", async () => {
    const model = createModel();
    const workerCount = model.create<metrics.Gauge<"count">>(
      "workerCount",
      metrics.Gauge,
      { unit: "count" },
    );
    model.create("spawner", Spawner, { workerCount });

    const engine = createEngine(model, { seed: "spawn-facade", duration: 5 });
    await engine.run();

    // Workers process 3 jobs each over 0.1s intervals
    // With duration=5 and 3 workers spawned at t=1,2,3, workers have time to process
    const snapshots = engine.snapshot();
    const counterSnapshots = snapshots.filter(
      (s) => s.value.type === "counter",
    );
    // At least one worker counter should have incremented
    expect(counterSnapshots.some((s) => s.value.value > 0)).toBe(true);
  });

  it("spawn with no onTopologyChange callback does not throw", async () => {
    const model = createModel();
    const workerCount = model.create<metrics.Gauge<"count">>(
      "workerCount",
      metrics.Gauge,
      { unit: "count" },
    );
    model.create("spawner", Spawner, { workerCount });

    const engine = createEngine(model, { seed: "no-cb" });
    // Should not throw even without onTopologyChange
    await expect(engine.run()).resolves.toBeUndefined();
  });

  it("spawn records parent-child relationships in spawnChildren", async () => {
    const model = createModel();
    const workerCount = model.create<metrics.Gauge<"count">>(
      "workerCount",
      metrics.Gauge,
      { unit: "count" },
    );
    model.create("spawner", Spawner, { workerCount });

    const engine = createEngine(model, { seed: "spawn-edges", duration: 5 });
    await engine.run();

    const spawnerReg = engine.registrations.find((r) => r.name === "spawner");
    expect(spawnerReg).toBeDefined();
    // Spawner creates 3 counters + 3 workers = 6 spawn children
    expect(spawnerReg!.spawnChildren).toHaveLength(6);
    expect(spawnerReg!.spawnChildren).toContain("worker-1");
    expect(spawnerReg!.spawnChildren).toContain("worker-1-jobs");
  });

  it("spawn without thunk uses sentinel defaults", async () => {
    class DefaultSpawner extends Blueprint {
      engineOnStart() {
        // No thunk — Counter's sentinel defaults provide unit: "count"
        this.engine.spawn("auto-counter", metrics.Counter);
      }
    }

    const model = createModel();
    model.create("defaultSpawner", DefaultSpawner, {});

    const engine = createEngine(model, { seed: "default-spawn", duration: 1 });
    await engine.step();

    const counterReg = engine.registrations.find(
      (r) => r.name === "auto-counter",
    );
    expect(counterReg).toBeDefined();
    expect(counterReg!.instance).toBeInstanceOf(metrics.Counter);
    // Sentinel default for unit should have been applied
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: narrow to Counter to check resolved params
    const counter = counterReg!.instance as metrics.Counter;
    expect(counter.params.unit).toBe("count");
  });

  it("onTopologyChange batches multiple spawns in same tick", async () => {
    // This spawner creates two nodes in the same engineOnStart (no await between)
    class BatchSpawner extends Blueprint {
      engineOnStart() {
        this.engine.spawn("a-counter", metrics.Counter, {
          unit: "count" as const,
        });
        this.engine.spawn("b-counter", metrics.Counter, {
          unit: "count" as const,
        });
      }
    }

    const model = createModel();
    model.create("batchSpawner", BatchSpawner, {});

    const cb = vi.fn();
    const engine = createEngine(model, {
      seed: "batch",
      onTopologyChange: cb,
    });

    // Run one step to flush microtasks from engineOnStart
    await engine.step();

    // The callback should have been called once (batched), not twice
    expect(cb).toHaveBeenCalledTimes(1);
    // Consumer can query engine.registrations to see all 3
    expect(engine.registrations).toHaveLength(3);
    expect(engine.registrations.map((r) => r.name)).toEqual(
      expect.arrayContaining(["batchSpawner", "a-counter", "b-counter"]),
    );
  });

  it("wire() on a node returned from engine.spawn throws — spawned nodes are wired immediately", async () => {
    class Spawner extends Blueprint {
      spawned: metrics.Counter | undefined;
      engineOnStart() {
        this.spawned = this.engine.spawn("c1", metrics.Counter, {
          unit: "count" as const,
        });
      }
    }

    const model = createModel();
    const spawner = model.create("spawner", Spawner, {});

    const engine = createEngine(model, { seed: "wire-spawn" });
    await engine.step();

    expect(spawner.spawned).toBeDefined();
    // engine.spawn marks `wired = true` immediately after wireNode, so any
    // subsequent .wire() call must throw — dynamic wiring during simulation
    // belongs in engine.spawn(), not in .wire().
    expect(() => spawner.spawned!.wire({ unit: "count" as const })).toThrow(
      /already wired/,
    );
  });

  it("wire() on a statically registered node throws after createEngine has run", () => {
    class Producer extends Blueprint {
      static params = {
        sink: component.ref(metrics.Counter),
      };
      declare params: typeof Producer.params;
    }

    const model = createModel();
    const sink = model.create<metrics.Counter<"count">>(
      "sink",
      metrics.Counter,
      { unit: "count" as const },
    );
    const producer = model.create("producer", Producer, { sink });

    createEngine(model, { seed: "wire-after-introspect" });

    // Both registrations are wired by introspect; .wire() must throw on either.
    expect(() => producer.wire({ sink })).toThrow(/already wired/);
    expect(() => sink.wire({ unit: "count" as const })).toThrow(
      /already wired/,
    );
  });
});
