import { describe, it, expect } from "vitest";
import { createEngine } from "@diagram/sim-default-engine";
import { model } from "./cache-example";

describe("[cache-example]", () => {
  it("builds and runs without errors, producing metric snapshots", async () => {
    const controller = createEngine(model, { seed: "test", duration: 1 });
    await controller.run();
    expect(controller.haltResult).toBeUndefined();
    expect(controller.snapshot().length).toBeGreaterThan(0);
  });
});
