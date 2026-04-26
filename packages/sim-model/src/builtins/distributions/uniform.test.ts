import { describe, it, expect } from "vitest";
import { createModel } from "../../model";
import { Uniform } from "./uniform";
import { createTestEngine } from "./test-prng";

function createWired(min: number, max: number, seed: string): Uniform {
  const model = createModel();
  const dist = model.create("u", Uniform, { min, max });
  dist.engine = createTestEngine(seed);
  // Wire params manually (mimic introspection)
  dist.params = { min, max };
  return dist;
}

describe("Uniform", () => {
  it("draws are in [min, max)", () => {
    const u = createWired(2, 5, "test");
    for (let i = 0; i < 1000; i++) {
      const v = u.draw();
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
    }
  });

  it("deterministic with same seed", () => {
    const a = createWired(0, 10, "det");
    const b = createWired(0, 10, "det");
    const seqA = Array.from({ length: 50 }, () => a.draw());
    const seqB = Array.from({ length: 50 }, () => b.draw());
    expect(seqA).toEqual(seqB);
  });

  it("mean ≈ (min+max)/2 over 10k samples", () => {
    const u = createWired(3, 7, "mean-test");
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) sum += u.draw();
    const sampleMean = sum / n;
    expect(sampleMean).toBeGreaterThan(4.8);
    expect(sampleMean).toBeLessThan(5.2);
  });
});
