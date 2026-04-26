import { describe, it, expect } from "vitest";
import { createModel } from "../../model";
import { Pareto } from "./pareto";
import { createTestEngine } from "./test-prng";

function createWired(scale: number, shape: number, seed: string): Pareto {
  const model = createModel();
  const dist = model.create("p", Pareto, { scale, shape });
  dist.engine = createTestEngine(seed);
  dist.params = { scale, shape };
  return dist;
}

describe("Pareto", () => {
  it("draws ≥ scale", () => {
    const p = createWired(2, 3, "min-test");
    for (let i = 0; i < 1000; i++) {
      expect(p.draw()).toBeGreaterThanOrEqual(2);
    }
  });

  it("deterministic with same seed", () => {
    const a = createWired(1, 2, "det");
    const b = createWired(1, 2, "det");
    const seqA = Array.from({ length: 50 }, () => a.draw());
    const seqB = Array.from({ length: 50 }, () => b.draw());
    expect(seqA).toEqual(seqB);
  });

  it("mean ≈ scale*shape/(shape-1) for shape > 1 over 10k samples", () => {
    const scale = 1;
    const shape = 3;
    const p = createWired(scale, shape, "mean-test");
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) sum += p.draw();
    const sampleMean = sum / n;
    const expectedMean = (scale * shape) / (shape - 1); // 1.5
    const ratio = sampleMean / expectedMean;
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(ratio).toBeLessThanOrEqual(1.1);
  });
});
