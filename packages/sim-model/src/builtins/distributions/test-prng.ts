import { Engine } from "../../blueprint";

/**
 * Minimal seeded PRNG for distribution unit tests. Uses a simple
 * mulberry32 algorithm. No external dependencies needed.
 */
class TestPRNG {
  private state: number;

  constructor(seed: string) {
    // Simple string hash to seed
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    }
    this.state = h >>> 0;
    if (this.state === 0) this.state = 1;
  }

  random(): number {
    // mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  exponential(mean: number): number {
    return -mean * Math.log(1 - this.random());
  }
}

/** Creates a test Engine facade backed by TestPRNG for distribution unit tests. */
export function createTestEngine(seed: string): Engine {
  const prng = new TestPRNG(seed);
  return new (class extends Engine {
    override random(): number {
      return prng.random();
    }
  })();
}
