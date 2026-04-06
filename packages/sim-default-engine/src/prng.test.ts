import { describe, it, expect } from "vitest";
import { PRNG } from "./prng";

describe("PRNG", () => {
  describe("[prng-deterministic]", () => {
    it("same seed produces identical sequence of random() calls", () => {
      const a = new PRNG("foo");
      const b = new PRNG("foo");
      const seqA: number[] = [];
      const seqB: number[] = [];

      for (let i = 0; i < 100; i++) {
        seqA.push(a.random());
        seqB.push(b.random());
      }

      expect(seqA).toEqual(seqB);
    });
  });

  describe("[prng-exponential]", () => {
    it("exponential(mean) produces values with approximately correct mean over 10000 samples", () => {
      const prng = new PRNG("exponential-test");
      const mean = 2.5;
      let sum = 0;
      const n = 10000;

      for (let i = 0; i < n; i++) {
        const v = prng.exponential(mean);
        expect(v).toBeGreaterThan(0);
        sum += v;
      }

      const sampleMean = sum / n;
      const ratio = sampleMean / mean;
      expect(ratio).toBeGreaterThanOrEqual(0.95);
      expect(ratio).toBeLessThanOrEqual(1.05);
    });

    it("all exponential values are positive", () => {
      const prng = new PRNG("positive-test");
      for (let i = 0; i < 1000; i++) {
        expect(prng.exponential(1)).toBeGreaterThan(0);
      }
    });
  });

  it("different seeds produce different sequences", () => {
    const a = new PRNG("seed-a");
    const b = new PRNG("seed-b");
    const seqA: number[] = [];
    const seqB: number[] = [];

    for (let i = 0; i < 50; i++) {
      seqA.push(a.random());
      seqB.push(b.random());
    }

    expect(seqA).not.toEqual(seqB);
  });
});
