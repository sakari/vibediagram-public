import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { LabelMap } from "./label-map";

const labelsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.string({ maxLength: 16 }),
  { minKeys: 0, maxKeys: 6 },
);

function shuffleKeys(labels: Record<string, string>): Record<string, string> {
  const keys = Object.keys(labels);
  const shuffled: Record<string, string> = {};
  for (let i = keys.length - 1; i >= 0; i--) {
    shuffled[keys[i]] = labels[keys[i]];
  }
  return shuffled;
}

describe("LabelMap", () => {
  describe("get-after-create", () => {
    it("get returns data stored via getOrCreate for any label set", () => {
      fc.assert(
        fc.property(labelsArb, fc.integer(), (labels, value) => {
          const m = new LabelMap<number>();
          m.getOrCreate(labels, () => value);
          expect(m.get(labels)).toBe(value);
        }),
        { numRuns: 200 },
      );
    });

    it("get returns undefined for labels never inserted", () => {
      fc.assert(
        fc.property(labelsArb, (labels) => {
          const m = new LabelMap<number>();
          expect(m.get(labels)).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("key-ordering-invariant", () => {
    it("reversed key order resolves to same entry", () => {
      fc.assert(
        fc.property(labelsArb, fc.integer(), (labels, value) => {
          const m = new LabelMap<number>();
          m.getOrCreate(labels, () => value);
          const reversed = shuffleKeys(labels);
          expect(m.get(reversed)).toBe(value);
          expect(m.size).toBe(1);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("init-called-once", () => {
    it("init is called exactly once per distinct label set", () => {
      fc.assert(
        fc.property(labelsArb, (labels) => {
          const m = new LabelMap<number>();
          let calls = 0;
          m.getOrCreate(labels, () => ++calls);
          m.getOrCreate(labels, () => ++calls);
          m.getOrCreate(shuffleKeys(labels), () => ++calls);
          expect(calls).toBe(1);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("size-tracks-distinct-sets", () => {
    it("size equals number of unique label sets inserted", () => {
      fc.assert(
        fc.property(
          fc.array(labelsArb, { minLength: 0, maxLength: 30 }),
          (labelSets) => {
            const m = new LabelMap<number>();
            const seen = new Set<string>();
            for (const labels of labelSets) {
              const key = Object.keys(labels)
                .sort()
                .map((k) => `${k}\0${labels[k]}`)
                .join("\0");
              seen.add(key);
              m.getOrCreate(labels, () => 0);
            }
            expect(m.size).toBe(seen.size);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("iteration-completeness", () => {
    it("iterating yields every inserted entry exactly once", () => {
      fc.assert(
        fc.property(
          fc.array(labelsArb, { minLength: 0, maxLength: 20 }),
          (labelSets) => {
            const m = new LabelMap<number>();
            let counter = 0;
            for (const labels of labelSets) {
              m.getOrCreate(labels, () => counter++);
            }
            const entries = [...m];
            expect(entries).toHaveLength(m.size);
            for (const { data } of entries) {
              expect(typeof data).toBe("number");
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("labels-are-snapshot-copies", () => {
    it("mutating original labels object does not affect stored entry", () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 4 }),
            fc.string({ maxLength: 8 }),
            { minKeys: 1, maxKeys: 4 },
          ),
          (labels) => {
            const m = new LabelMap<number>();
            const original = { ...labels };
            m.getOrCreate(labels, () => 1);
            const key = Object.keys(labels)[0];
            labels[key] = "MUTATED";
            const [entry] = [...m];
            expect(entry.labels).toEqual(original);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
