import { describe, it, expect } from "vitest";
import { createEngine } from "@diagram/sim-default-engine";
import { buildModel } from "./worker-pool-example";

describe("[worker-pool-example]", () => {
  it("builds and runs without errors, producing metric snapshots", async () => {
    const controller = createEngine(buildModel(), {
      seed: "test",
      duration: 1,
    });
    await controller.run();
    expect(controller.haltResult).toBeUndefined();
    expect(controller.snapshot().length).toBeGreaterThan(0);
  });

  it("respects the maxWorkers cap at default inputs", async () => {
    // Default inputs (arrivalRate=1, maxWorkers=1): a single worker easily
    // keeps up, so the supervisor never spawns past the initial one.
    const controller = createEngine(buildModel(), {
      seed: "test",
      duration: 5,
    });
    await controller.run();

    const workerRegs = controller.registrations.filter((r) =>
      /^worker-\d+$/.test(r.name),
    );
    expect(workerRegs).toHaveLength(1);
  });

  it("spawns additional workers when load exceeds capacity", async () => {
    // Override inputs to force the supervisor to scale up:
    // 20 tasks/s × 0.2s service time ≈ 4 workers needed, cap at 4.
    const controller = createEngine(buildModel(), {
      seed: "test",
      duration: 10,
    });
    const arrivalInput = controller.inputRegistry.get("arrivalRate");
    const maxInput = controller.inputRegistry.get("maxWorkers");
    if (!arrivalInput || !maxInput)
      throw new Error("expected input registrations");
    arrivalInput.value = 20;
    maxInput.value = 4;

    await controller.run();

    const workerRegs = controller.registrations.filter((r) =>
      /^worker-\d+$/.test(r.name),
    );
    expect(workerRegs.length).toBeGreaterThan(1);
    expect(workerRegs.length).toBeLessThanOrEqual(4);
  });
});
