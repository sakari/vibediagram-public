import { bench, describe } from "vitest";
import { EventQueue } from "./event-queue";

function seedRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

describe("EventQueue push", () => {
  for (const size of [1_000, 10_000, 100_000]) {
    bench(`push ${String(size)} events`, () => {
      const q = new EventQueue();
      const rng = seedRandom(42);
      for (let i = 0; i < size; i++) {
        q.push(rng() * 1000, i, () => {});
      }
    });
  }
});

describe("EventQueue pop (drain)", () => {
  for (const size of [1_000, 10_000, 100_000]) {
    bench(`pop ${String(size)} from full queue`, () => {
      const q = new EventQueue();
      const rng = seedRandom(42);
      for (let i = 0; i < size; i++) {
        q.push(rng() * 1000, i, () => {});
      }
      while (q.size > 0) {
        q.pop();
      }
    });
  }
});

describe("EventQueue push+pop interleaved", () => {
  for (const size of [1_000, 10_000, 100_000]) {
    bench(`push+pop ${String(size)} interleaved`, () => {
      const q = new EventQueue();
      const rng = seedRandom(42);
      // Pre-fill half
      for (let i = 0; i < size / 2; i++) {
        q.push(rng() * 1000, i, () => {});
      }
      // Interleave push and pop
      for (let i = 0; i < size; i++) {
        q.push(rng() * 1000, i + size, () => {});
        q.pop();
      }
    });
  }
});
