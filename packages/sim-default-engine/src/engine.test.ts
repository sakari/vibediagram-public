import { describe, it, expect } from "vitest";
import {
  Blueprint,
  Engine,
  component,
  metrics,
  createModel,
} from "@diagram/sim-model";
import { createEngine } from "./create-engine";

class DelayBlueprint extends Blueprint {
  log: number[] = [];
  engineOnStart() {
    void this.scheduleDelay();
  }
  async scheduleDelay() {
    await this.engine.timeout(0.5);
    this.log.push(0.5);
    await this.engine.timeout(0.3);
    this.log.push(0.8);
  }
}

describe("[engine-timeout]", () => {
  it("engine.timeout(0.5) resolves after simulated 0.5 seconds; log shows [0.5, 0.8]", async () => {
    const model = createModel();
    const delay = model.create("delay", DelayBlueprint, {});
    const controller = createEngine(model, { seed: "test" });
    await controller.run();
    expect(delay.log).toEqual([0.5, 0.8]);
    expect(controller.currentTime).toBe(0.8);
  });
});

describe("[engine-deterministic]", () => {
  it("same model and seed yields identical currentTime and metric snapshots", async () => {
    class MetricBlueprint extends Blueprint {
      static params = { counter: component.ref(metrics.Counter) };
      declare params: typeof MetricBlueprint.params;
      engineOnStart() {
        this.params.counter.increment({}, 1);
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.params.counter.increment({}, 1);
      }
    }

    const runOnce = async () => {
      const model = createModel();
      const counter = model.create<metrics.Counter<"count", "name">>(
        "counter",
        metrics.Counter,
        {
          unit: "count",
        },
      );
      model.create("bp", MetricBlueprint, { counter });
      const controller = createEngine(model, { seed: "deterministic" });
      await controller.run();
      return { time: controller.currentTime, snap: controller.snapshot() };
    };

    const a = await runOnce();
    const b = await runOnce();
    expect(a.time).toBe(b.time);
    expect(a.snap).toEqual(b.snap);
    expect(a.time).toBe(1);
  });
});

describe("[engine-promise-race]", () => {
  it("Promise.race between timeout(1) and timeout(0.5) resolves with 0.5s branch", async () => {
    class RaceBlueprint extends Blueprint {
      winner: "short" | "long" | null = null;
      engineOnStart() {
        void this.runRace();
      }
      async runRace() {
        const result = await Promise.race([
          this.engine.timeout(1).then(() => "long" as const),
          this.engine.timeout(0.5).then(() => "short" as const),
        ]);
        this.winner = result;
      }
    }

    const model = createModel();
    const race = model.create("race", RaceBlueprint, {});
    const controller = createEngine(model, { seed: "race" });
    await controller.run();
    expect(race.winner).toBe("short");
    expect(controller.currentTime).toBe(1);
  });
});

describe("[engine-direct-calls]", () => {
  it("Blueprint A calls Blueprint B async method directly; no sim time passes", async () => {
    class ServiceB extends Blueprint {
      doWork(): Promise<string> {
        return Promise.resolve("done");
      }
    }

    class ServiceA extends Blueprint {
      static params = { b: component.ref(ServiceB) };
      declare params: typeof ServiceA.params;
      result = "";
      engineOnStart() {
        void this.start();
      }
      async start() {
        this.result = await this.params.b.doWork();
      }
    }

    const model = createModel();
    const serviceB = model.create("b", ServiceB, {});
    const serviceA = model.create("a", ServiceA, { b: serviceB });
    const controller = createEngine(model, { seed: "direct" });
    await controller.run();
    expect(serviceA.result).toBe("done");
    expect(controller.currentTime).toBe(0);
  });
});

describe("[engine-duration]", () => {
  it("with duration 10, events past t=10 are not processed", async () => {
    class LateBlueprint extends Blueprint {
      resolved = false;
      engineOnStart() {
        void this.scheduleLate();
      }
      async scheduleLate() {
        await this.engine.timeout(15);
        this.resolved = true;
      }
    }

    const model = createModel();
    const late = model.create("late", LateBlueprint, {});
    const controller = createEngine(model, { seed: "duration", duration: 10 });
    await controller.run();
    expect(late.resolved).toBe(false);
    expect(controller.currentTime).toBeLessThanOrEqual(10);
  });
});

describe("[engine-step]", () => {
  it("step() processes exactly one event; currentTime advances per step", async () => {
    class StepBlueprint extends Blueprint {
      log: number[] = [];
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.log.push(1);
        await this.engine.timeout(2);
        this.log.push(2);
      }
    }

    const model = createModel();
    model.create("step", StepBlueprint, {});
    const controller = createEngine(model, { seed: "step" });

    const r1 = await controller.step();
    expect(r1).toBe(true);
    expect(controller.currentTime).toBe(1);
    expect(controller.snapshot()).toEqual([]);

    const r2 = await controller.step();
    expect(r2).toBe(true);
    expect(controller.currentTime).toBe(3);

    const r3 = await controller.step();
    expect(r3).toBe(false);

    const stepReg = model.registrations.find((r) => r.name === "step");
    const step = stepReg?.instance;
    expect(step).toBeInstanceOf(StepBlueprint);
    if (step instanceof StepBlueprint) {
      expect(step.log).toEqual([1, 2]);
    }
  });
});

describe("[engine-pause-resume]", () => {
  it("pause() stops run loop; run() again resumes and processes remaining events", async () => {
    class MultiDelayBlueprint extends Blueprint {
      log: number[] = [];
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.log.push(1);
        await this.engine.timeout(2);
        this.log.push(2);
        await this.engine.timeout(3);
        this.log.push(3);
      }
    }

    const model = createModel();
    const bp = model.create("multi", MultiDelayBlueprint, {});
    const controller = createEngine(model, { seed: "pause" });

    const runPromise = controller.run();
    controller.pause();
    await runPromise;

    await controller.run();
    expect(controller.currentTime).toBe(6);
    expect(bp.log).toEqual([1, 2, 3]);
  });

  it("step-based loop resumes from where it paused, not from beginning", async () => {
    class AccumulatorBlueprint extends Blueprint {
      count = 0;
      engineOnStart() {
        void this.work();
      }
      async work() {
        for (let i = 0; i < 5; i++) {
          await this.engine.timeout(1);
          this.count++;
        }
      }
    }

    const model = createModel();
    const bp = model.create("bp", AccumulatorBlueprint, {});
    const controller = createEngine(model, { seed: "step-pause" });

    await controller.step();
    await controller.step();
    expect(controller.currentTime).toBe(2);
    expect(bp.count).toBe(2);

    while (await controller.step());

    expect(controller.currentTime).toBe(5);
    expect(bp.count).toBe(5);
  });
});

describe("[engine-initial-flush]", () => {
  it("fire-and-forget async chains from engineOnStart enqueue timeouts before the run loop", async () => {
    class ChainA extends Blueprint {
      log: string[] = [];
      engineOnStart() {
        void this.go();
      }
      async go() {
        await this.engine.timeout(1);
        this.log.push("a");
      }
    }

    class ChainB extends Blueprint {
      log: string[] = [];
      engineOnStart() {
        void this.go();
      }
      async go() {
        await this.engine.timeout(2);
        this.log.push("b");
      }
    }

    const model = createModel();
    const a = model.create("a", ChainA, {});
    const b = model.create("b", ChainB, {});
    const controller = createEngine(model, { seed: "initial-flush" });
    await controller.run();

    expect(a.log).toEqual(["a"]);
    expect(b.log).toEqual(["b"]);
    expect(controller.currentTime).toBe(2);
  });
});

describe("[engine-random]", () => {
  it("engine.random() returns deterministic values in [0, 1)", async () => {
    class RandomBlueprint extends Blueprint {
      values: number[] = [];
      engineOnStart() {
        for (let i = 0; i < 10; i++) {
          this.values.push(this.engine.random());
        }
      }
    }

    const model = createModel();
    const bp = model.create("rng", RandomBlueprint, {});
    const controller = createEngine(model, { seed: "random-test" });
    await controller.run();

    expect(bp.values).toHaveLength(10);
    for (const v of bp.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(bp.values).size).toBe(10);
  });

  it("same seed produces identical random sequence", async () => {
    class RandomBlueprint extends Blueprint {
      values: number[] = [];
      engineOnStart() {
        for (let i = 0; i < 5; i++) {
          this.values.push(this.engine.random());
        }
      }
    }

    const collect = async () => {
      const model = createModel();
      const bp = model.create("rng", RandomBlueprint, {});
      const controller = createEngine(model, { seed: "deterministic-rng" });
      await controller.run();
      return bp.values;
    };

    const a = await collect();
    const b = await collect();
    expect(a).toEqual(b);
  });
});

describe("[engine-snapshot]", () => {
  it("snapshot() returns Counter data after simulation", async () => {
    class CounterBlueprint extends Blueprint {
      static params = { counter: component.ref(metrics.Counter) };
      declare params: typeof CounterBlueprint.params;
      engineOnStart() {
        this.params.counter.increment({ name: "foo" }, 3);
        this.params.counter.increment({ name: "bar" }, 7);
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.params.counter.increment({ name: "foo" }, 2);
      }
    }

    const model = createModel();
    const counter = model.create<metrics.Counter<"count", "name">>(
      "counter",
      metrics.Counter,
      {
        unit: "count",
      },
    );
    model.create("bp", CounterBlueprint, { counter });
    const controller = createEngine(model, { seed: "snapshot" });
    await controller.run();

    const snap = controller.snapshot();
    expect(snap).toHaveLength(2);
    const foo = snap.find((s) => s.labels.name === "foo");
    const bar = snap.find((s) => s.labels.name === "bar");
    expect(foo).toBeDefined();

    expect(foo!.value).toEqual({ type: "counter", value: 5 });
    expect(foo!.unit).toBe("count");
    expect(bar).toBeDefined();
    expect(bar!.value).toEqual({ type: "counter", value: 7 });
    expect(bar!.unit).toBe("count");
  });
});

describe("[engine-halt]", () => {
  it("halt() inside Blueprint stops the run loop, run() resolves", async () => {
    class HaltBlueprint extends Blueprint {
      postHaltLog: number[] = [];
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.engine.halt("test");
        await this.engine.timeout(1);
        this.postHaltLog.push(2);
      }
    }

    const model = createModel();
    const bp = model.create("bp", HaltBlueprint, {});
    const controller = createEngine(model, { seed: "halt" });
    await controller.run();
    expect(bp.postHaltLog).toEqual([]);
  });

  it("haltResult contains reason and time after halt", async () => {
    class HaltBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(5);
        this.engine.halt("invariant failed");
      }
    }

    const model = createModel();
    model.create("bp", HaltBlueprint, {});
    const controller = createEngine(model, { seed: "halt-result" });
    await controller.run();
    expect(controller.haltResult).toEqual({
      reason: "invariant failed",
      time: 5,
    });
  });

  it("haltResult is undefined after normal run", async () => {
    class NormalBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
      }
    }

    const model = createModel();
    model.create("bp", NormalBlueprint, {});
    const controller = createEngine(model, { seed: "normal" });
    await controller.run();
    expect(controller.haltResult).toBeUndefined();
  });

  it("step() returns false after halt", async () => {
    class HaltBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.engine.halt("stop");
        await this.engine.timeout(1);
      }
    }

    const model = createModel();
    model.create("bp", HaltBlueprint, {});
    const controller = createEngine(model, { seed: "step-halt" });

    const r1 = await controller.step();
    expect(r1).toBe(true);
    expect(controller.haltResult).toEqual(
      expect.objectContaining({ reason: "stop" }),
    );

    const r2 = await controller.step();
    expect(r2).toBe(false);
  });

  it("second halt() does not overwrite first", async () => {
    class DoubleHaltBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.engine.halt("first");
        this.engine.halt("second");
      }
    }

    const model = createModel();
    model.create("bp", DoubleHaltBlueprint, {});
    const controller = createEngine(model, { seed: "double-halt" });
    await controller.run();
    expect(controller.haltResult).toEqual({ reason: "first", time: 1 });
  });

  it("halt() inside try/catch still stops simulation", async () => {
    class TryCatchBlueprint extends Blueprint {
      postHaltLog: string[] = [];
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        try {
          await this.engine.timeout(1);
          this.engine.halt("caught-halt");
          await this.engine.timeout(1);
          this.postHaltLog.push("should-not-run");
        } catch {
          this.postHaltLog.push("catch-block");
        }
      }
    }

    const model = createModel();
    const bp = model.create("bp", TryCatchBlueprint, {});
    const controller = createEngine(model, { seed: "try-catch" });
    await controller.run();
    expect(controller.haltResult).toEqual(
      expect.objectContaining({ reason: "caught-halt" }),
    );
    expect(bp.postHaltLog).toEqual([]);
  });

  it("halt() in engineOnStart prevents any events from processing", async () => {
    class EarlyHaltBlueprint extends Blueprint {
      eventRan = false;
      engineOnStart() {
        this.engine.halt("early");
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.eventRan = true;
      }
    }

    const model = createModel();
    const bp = model.create("bp", EarlyHaltBlueprint, {});
    const controller = createEngine(model, { seed: "early-halt" });
    await controller.run();
    expect(bp.eventRan).toBe(false);
    expect(controller.haltResult).toEqual({ reason: "early", time: 0 });
  });

  it("halt() called from non-Blueprint helper with Engine reference", async () => {
    function externalHalt(engine: Engine, reason: string): void {
      engine.halt(reason);
    }

    class HelperBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        externalHalt(this.engine, "external-halt");
        await this.engine.timeout(1);
      }
    }

    const model = createModel();
    model.create("bp", HelperBlueprint, {});
    const controller = createEngine(model, { seed: "helper-halt" });
    await controller.run();
    expect(controller.haltResult).toEqual(
      expect.objectContaining({ reason: "external-halt" }),
    );
  });

  it("run() after halt resolves immediately (halt is sticky)", async () => {
    class HaltBlueprint extends Blueprint {
      runCount = 0;
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.runCount++;
        this.engine.halt("done");
        await this.engine.timeout(1);
        this.runCount++;
      }
    }

    const model = createModel();
    const bp = model.create("bp", HaltBlueprint, {});
    const controller = createEngine(model, { seed: "sticky-halt" });
    await controller.run();
    expect(bp.runCount).toBe(1);

    await controller.run();
    expect(bp.runCount).toBe(1);
    expect(controller.haltResult).toEqual(
      expect.objectContaining({ reason: "done" }),
    );
  });
});

describe("[engine-snapshot-unit]", () => {
  it("snapshot() includes unit field from counter thunk", async () => {
    class ByteCounterBlueprint extends Blueprint {
      static params = { counter: component.ref(metrics.Counter) };
      declare params: typeof ByteCounterBlueprint.params;
      engineOnStart() {
        this.params.counter.increment({ name: "tx" }, 1536);
        this.params.counter.increment({ name: "rx" }, 4096);
      }
    }

    const model = createModel();
    const counter = model.create<metrics.Counter<"byte", "name">>(
      "counter",
      metrics.Counter,
      {
        unit: "byte",
      },
    );
    model.create("bp", ByteCounterBlueprint, { counter });
    const controller = createEngine(model, { seed: "snapshot-unit" });
    await controller.run();

    const snap = controller.snapshot();
    expect(snap).toHaveLength(2);

    const tx = snap.find((s) => s.labels.name === "tx");
    const rx = snap.find((s) => s.labels.name === "rx");
    expect(tx).toEqual(
      expect.objectContaining({
        value: { type: "counter", value: 1536 },
        unit: "byte",
      }),
    );
    expect(rx).toEqual(
      expect.objectContaining({
        value: { type: "counter", value: 4096 },
        unit: "byte",
      }),
    );
  });
});

describe("[engine-halt-exception]", () => {
  it("uncaught exception becomes halt, run() resolves", async () => {
    class ThrowingBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        throw new Error("unexpected failure");
      }
    }

    const model = createModel();
    model.create("bp", ThrowingBlueprint, {});
    const controller = createEngine(model, { seed: "exception-halt" });
    await controller.run();
    expect(controller.haltResult).toBeDefined();
    expect(controller.haltResult!.reason).toBe("unexpected failure");
    expect(controller.haltResult!.time).toBe(1);
  });

  it("non-Error rejection is captured as string reason", async () => {
    class StringThrowBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- testing non-Error rejection
        throw "plain string reason";
      }
    }

    const model = createModel();
    model.create("bp", StringThrowBlueprint, {});
    const controller = createEngine(model, { seed: "string-throw" });
    await controller.run();
    expect(controller.haltResult).toBeDefined();
    expect(controller.haltResult!.reason).toBe("plain string reason");
  });

  it("explicit halt() takes precedence over subsequent exception", async () => {
    class HaltThenThrowBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.engine.halt("intentional");
        throw new Error("also thrown");
      }
    }

    const model = createModel();
    model.create("bp", HaltThenThrowBlueprint, {});
    const controller = createEngine(model, { seed: "halt-then-throw" });
    await controller.run();
    expect(controller.haltResult).toBeDefined();
    expect(controller.haltResult!.reason).toBe("intentional");
  });

  it("uncaught exception during step() is captured as halt", async () => {
    class StepThrowBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        throw new Error("step-exception");
      }
    }

    const model = createModel();
    model.create("bp", StepThrowBlueprint, {});
    const controller = createEngine(model, { seed: "step-exception" });
    const r1 = await controller.step();
    expect(r1).toBe(true);
    expect(controller.haltResult).toBeDefined();
    expect(controller.haltResult!.reason).toBe("step-exception");
    const r2 = await controller.step();
    expect(r2).toBe(false);
  });
});

describe("[engine-invariant]", () => {
  it("engineCheckInvariant() is called after each flush; halt stops the run loop", async () => {
    let checkCount = 0;

    class InvariantBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        await this.engine.timeout(1);
        await this.engine.timeout(1);
      }
      engineCheckInvariant(): void {
        checkCount++;
        if (checkCount >= 2) {
          this.engine.halt("invariant violated");
        }
      }
    }

    const model = createModel();
    model.create("bp", InvariantBlueprint, {});
    const controller = createEngine(model, { seed: "invariant" });
    await controller.run();

    expect(checkCount).toBe(2);
    expect(controller.haltResult).toEqual({
      reason: "invariant violated",
      time: 2,
    });
  });

  it("all Blueprints' invariants are called even if an earlier one halts", async () => {
    const callOrder: string[] = [];

    class FirstBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
      }
      engineCheckInvariant(): void {
        callOrder.push("first");
        this.engine.halt("first-halt");
      }
    }

    class SecondBlueprint extends Blueprint {
      engineCheckInvariant(): void {
        callOrder.push("second");
      }
    }

    const model = createModel();
    model.create("a", FirstBlueprint, {});
    model.create("b", SecondBlueprint, {});
    const controller = createEngine(model, { seed: "multi-invariant" });
    await controller.run();

    expect(callOrder).toContain("first");
    expect(callOrder).toContain("second");
    expect(controller.haltResult).toEqual(
      expect.objectContaining({ reason: "first-halt" }),
    );
  });

  it("step() triggers invariant checks (step-parity)", async () => {
    let checkCount = 0;

    class StepInvariantBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        await this.engine.timeout(1);
      }
      engineCheckInvariant(): void {
        checkCount++;
      }
    }

    const model = createModel();
    model.create("bp", StepInvariantBlueprint, {});
    const controller = createEngine(model, { seed: "step-invariant" });

    await controller.step();
    expect(checkCount).toBe(1);

    await controller.step();
    expect(checkCount).toBe(2);
  });

  it("models without engineCheckInvariant overrides work unchanged", async () => {
    class PlainBlueprint extends Blueprint {
      log: number[] = [];
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.log.push(1);
        await this.engine.timeout(1);
        this.log.push(2);
      }
    }

    const model = createModel();
    const bp = model.create("bp", PlainBlueprint, {});
    const controller = createEngine(model, { seed: "no-invariant" });
    await controller.run();

    expect(bp.log).toEqual([1, 2]);
    expect(controller.haltResult).toBeUndefined();
  });

  it("invariant halt records correct simulated time", async () => {
    class TimedInvariantBlueprint extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(5);
        await this.engine.timeout(3);
      }
      engineCheckInvariant(): void {
        if (this.engine.random() >= 0) {
          this.engine.halt("time-check");
        }
      }
    }

    const model = createModel();
    model.create("bp", TimedInvariantBlueprint, {});
    const controller = createEngine(model, { seed: "timed-invariant" });
    await controller.run();

    expect(controller.haltResult).toBeDefined();
    expect(controller.haltResult!.time).toBe(5);
  });

  it("throwing invariant becomes a halt and does not skip remaining Blueprints", async () => {
    const callOrder: string[] = [];

    class ThrowingInvariant extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
      }
      engineCheckInvariant(): void {
        callOrder.push("thrower");
        throw new Error("invariant explosion");
      }
    }

    class SecondInvariant extends Blueprint {
      engineCheckInvariant(): void {
        callOrder.push("second");
      }
    }

    const model = createModel();
    model.create("a", ThrowingInvariant, {});
    model.create("b", SecondInvariant, {});
    const controller = createEngine(model, { seed: "throw-invariant" });
    await controller.run();

    expect(callOrder).toContain("thrower");
    expect(callOrder).toContain("second");
    expect(controller.haltResult).toEqual({
      reason: "invariant explosion",
      time: 1,
    });
  });

  it("dynamically spawned Blueprint invariants are checked", async () => {
    let spawnedInvariantCount = 0;

    class SpawnedChild extends Blueprint {
      engineCheckInvariant(): void {
        spawnedInvariantCount++;
      }
    }

    class Spawner extends Blueprint {
      engineOnStart() {
        void this.schedule();
      }
      async schedule() {
        await this.engine.timeout(1);
        this.engine.spawn("child", SpawnedChild, {});
        await this.engine.timeout(1);
      }
    }

    const model = createModel();
    model.create("spawner", Spawner, {});
    const controller = createEngine(model, { seed: "spawn-invariant" });
    await controller.run();

    expect(spawnedInvariantCount).toBeGreaterThanOrEqual(1);
  });
});

describe("[engine-now]", () => {
  it("engine.now() returns current simulated time matching controller.currentTime", async () => {
    class NowBlueprint extends Blueprint {
      times: number[] = [];
      engineOnStart() {
        void this.recordTimes();
      }
      async recordTimes() {
        this.times.push(this.engine.now());
        await this.engine.timeout(0.5);
        this.times.push(this.engine.now());
        await this.engine.timeout(0.3);
        this.times.push(this.engine.now());
      }
    }

    const model = createModel();
    const bp = model.create("now-test", NowBlueprint, {});
    const controller = createEngine(model, { seed: "now-test" });
    await controller.run();

    expect(bp.times).toEqual([0, 0.5, 0.8]);
    expect(controller.currentTime).toBe(0.8);
  });
});
