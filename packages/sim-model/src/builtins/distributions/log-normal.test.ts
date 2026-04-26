import { describe, it, expect } from "vitest";
import { createModel } from "../../model";
import { LogNormal } from "./log-normal";
import { createTestEngine } from "./test-prng";

function createWired(mu: number, sigma: number, seed: string): LogNormal {
  const model = createModel();
  const dist = model.create("ln", LogNormal, { mu, sigma });
  dist.engine = createTestEngine(seed);
  dist.params = { mu, sigma };
  return dist;
}

describe("LogNormal", () => {
  it("draws are positive", () => {
    const ln = createWired(0, 1, "pos");
    for (let i = 0; i < 1000; i++) {
      expect(ln.draw()).toBeGreaterThan(0);
    }
  });

  it("deterministic with same seed", () => {
    const a = createWired(0, 1, "det");
    const b = createWired(0, 1, "det");
    const seqA = Array.from({ length: 50 }, () => a.draw());
    const seqB = Array.from({ length: 50 }, () => b.draw());
    expect(seqA).toEqual(seqB);
  });

  it("mean ≈ exp(mu + sigma²/2) over 10k samples", () => {
    const mu = 1;
    const sigma = 0.5;
    const ln = createWired(mu, sigma, "mean-test");
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) sum += ln.draw();
    const sampleMean = sum / n;
    const expectedMean = Math.exp(mu + (sigma * sigma) / 2);
    const ratio = sampleMean / expectedMean;
    expect(ratio).toBeGreaterThanOrEqual(0.93);
    expect(ratio).toBeLessThanOrEqual(1.07);
  });
});
