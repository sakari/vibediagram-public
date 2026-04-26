import { describe, it, expect } from "vitest";
import { createModel } from "../../model";
import { Exponential } from "./exponential";
import { createTestEngine } from "./test-prng";

function createWired(mean: number, seed: string): Exponential {
  const model = createModel();
  const dist = model.create("e", Exponential, { mean });
  dist.engine = createTestEngine(seed);
  dist.params = { mean };
  return dist;
}

describe("Distribution.defaultStyleRules", () => {
  it("returns a hidden rule matching the subclass className", () => {
    const rules = Exponential.defaultStyleRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].match).toEqual({ data: { className: "Exponential" } });
    expect(rules[0].style).toEqual({ display: "hidden" });
  });
});

describe("Exponential", () => {
  it("draws are positive", () => {
    const e = createWired(2, "pos");
    for (let i = 0; i < 1000; i++) {
      expect(e.draw()).toBeGreaterThan(0);
    }
  });

  it("deterministic with same seed", () => {
    const a = createWired(1, "det");
    const b = createWired(1, "det");
    const seqA = Array.from({ length: 50 }, () => a.draw());
    const seqB = Array.from({ length: 50 }, () => b.draw());
    expect(seqA).toEqual(seqB);
  });

  it("mean ≈ param mean over 10k samples", () => {
    const e = createWired(3, "mean-test");
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) sum += e.draw();
    const sampleMean = sum / n;
    const ratio = sampleMean / 3;
    expect(ratio).toBeGreaterThanOrEqual(0.95);
    expect(ratio).toBeLessThanOrEqual(1.05);
  });
});
