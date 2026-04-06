import seedrandom from "seedrandom";

/**
 * Seeded pseudorandom number generator. Used for deterministic simulation behavior.
 */
export class PRNG {
  private rng: seedrandom.PRNG;

  constructor(seed: string) {
    this.rng = seedrandom(seed);
  }

  /**
   * Returns a value in [0, 1). Same seed yields identical sequence.
   */
  random(): number {
    return this.rng();
  }

  /**
   * Exponentially distributed value with the given mean.
   * Uses 1 - random() to avoid log(0) since random is [0, 1).
   */
  exponential(mean: number): number {
    return -mean * Math.log(1 - this.random());
  }
}
