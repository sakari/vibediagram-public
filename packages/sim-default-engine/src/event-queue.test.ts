import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { EventQueue } from "./event-queue";

describe("EventQueue", () => {
  describe("[eq-ordering]", () => {
    it("pops events in (time, tiebreaker) order", () => {
      const q = new EventQueue();
      const order: number[] = [];
      q.push(30, 2, () => order.push(1));
      q.push(10, 0, () => order.push(2));
      q.push(20, 1, () => order.push(3));
      q.push(10, 1, () => order.push(4));
      q.push(20, 0, () => order.push(5));

      expect(q.pop().time).toBe(10);
      expect(q.pop().time).toBe(10);
      expect(q.pop().time).toBe(20);
      expect(q.pop().time).toBe(20);
      expect(q.pop().time).toBe(30);

      expect(q.size).toBe(0);
    });

    it("sorts by tiebreaker when times are equal", () => {
      const q = new EventQueue();
      q.push(5, 3, () => {});
      q.push(5, 1, () => {});
      q.push(5, 2, () => {});

      expect(q.pop().tiebreaker).toBe(1);
      expect(q.pop().tiebreaker).toBe(2);
      expect(q.pop().tiebreaker).toBe(3);
    });
  });

  describe("[eq-heap]", () => {
    it("maintains heap invariant for 1000+ entries", () => {
      const q = new EventQueue();
      const pairs: [number, number][] = [];
      for (let i = 0; i < 1000; i++) {
        pairs.push([Math.floor(Math.random() * 10000), i]);
      }

      for (const [time, tiebreaker] of pairs) {
        q.push(time, tiebreaker, () => {});
      }

      let prev: { time: number; tiebreaker: number } | undefined;
      while (q.size > 0) {
        const entry = q.pop();
        if (prev) {
          const cmp =
            entry.time - prev.time || entry.tiebreaker - prev.tiebreaker;
          expect(cmp).toBeGreaterThanOrEqual(0);
        }
        prev = entry;
      }
    });
  });

  it("throws when pop called on empty queue", () => {
    const q = new EventQueue();
    expect(() => q.pop()).toThrow("EventQueue.pop() called on empty queue");
  });

  it("peek returns undefined when empty", () => {
    const q = new EventQueue();
    expect(q.peek()).toBeUndefined();
  });

  it("peek returns min without removing", () => {
    const q = new EventQueue();
    q.push(10, 0, () => {});
    q.push(20, 0, () => {});

    expect(q.peek()?.time).toBe(10);
    expect(q.size).toBe(2);

    q.pop();
    expect(q.peek()?.time).toBe(20);
    expect(q.size).toBe(1);
  });

  describe("[eq-property-based]", () => {
    it("popped sequence is always sorted for arbitrary (time, tiebreaker) inputs", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.float({ min: 0, max: 1e6, noNaN: true }),
              fc.float({ min: 0, max: 1, noNaN: true }),
            ),
            { minLength: 1, maxLength: 500 },
          ),
          (entries) => {
            const q = new EventQueue();
            for (const [time, tiebreaker] of entries) {
              q.push(time, tiebreaker, () => {});
            }

            let prev: { time: number; tiebreaker: number } | undefined;
            while (q.size > 0) {
              const entry = q.pop();
              if (prev) {
                const cmp =
                  entry.time - prev.time || entry.tiebreaker - prev.tiebreaker;
                if (cmp < 0) return false;
              }
              prev = entry;
            }
            return true;
          },
        ),
        { numRuns: 200 },
      );
    });

    it("size matches number of pushed minus popped entries", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.float({ min: 0, max: 1e6, noNaN: true }),
              fc.float({ min: 0, max: 1, noNaN: true }),
            ),
            { minLength: 0, maxLength: 200 },
          ),
          fc.nat({ max: 200 }),
          (entries, popCount) => {
            const q = new EventQueue();
            for (const [time, tiebreaker] of entries) {
              q.push(time, tiebreaker, () => {});
            }
            const actualPops = Math.min(popCount, entries.length);
            for (let i = 0; i < actualPops; i++) q.pop();
            return q.size === entries.length - actualPops;
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
