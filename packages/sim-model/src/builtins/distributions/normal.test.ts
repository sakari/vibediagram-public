import { describe, it, expect } from "vitest";
import { createModel } from "../../model";
import { Normal } from "./normal";
import { createTestEngine } from "./test-prng";

function createWired(mean: number, stddev: number, seed: string): Normal {
  const model = createModel();
  const dist = model.create("n", Normal, () => ({ mean, stddev }));
  dist.engine = createTestEngine(seed);
  dist.params = { mean, stddev };
  return dist;
}

describe("Normal", () => {
  it("deterministic with same seed", () => {
    const a = createWired(0, 1, "det");
    const b = createWired(0, 1, "det");
    const seqA = Array.from({ length: 50 }, () => a.draw());
    const seqB = Array.from({ length: 50 }, () => b.draw());
    expect(seqA).toEqual(seqB);
  });

  it("mean ≈ param mean over 10k samples", () => {
    const n = createWired(5, 2, "mean-test");
    let sum = 0;
    const count = 10000;
    for (let i = 0; i < count; i++) sum += n.draw();
    const sampleMean = sum / count;
    expect(sampleMean).toBeGreaterThan(4.8);
    expect(sampleMean).toBeLessThan(5.2);
  });

  it("stddev ≈ param stddev over 10k samples", () => {
    const mean = 0;
    const stddev = 3;
    const n = createWired(mean, stddev, "std-test");
    const values: number[] = [];
    const count = 10000;
    for (let i = 0; i < count; i++) values.push(n.draw());
    const sampleMean = values.reduce((a, b) => a + b, 0) / count;
    const variance =
      values.reduce((a, b) => a + (b - sampleMean) ** 2, 0) / count;
    const sampleStd = Math.sqrt(variance);
    expect(sampleStd).toBeGreaterThan(2.7);
    expect(sampleStd).toBeLessThan(3.3);
  });
});
