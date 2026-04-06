import { bench, describe } from "vitest";
import { LabelMap } from "./label-map";

function makeLabelSets(
  labelCount: number,
  keyCount: number,
): Record<string, string>[] {
  const labels: Record<string, string>[] = [];
  for (let i = 0; i < keyCount; i++) {
    const record: Record<string, string> = {};
    for (let j = 0; j < labelCount; j++) {
      record[`label${String(j)}`] = `v${String(i)}_${String(j)}`;
    }
    labels.push(record);
  }
  return labels;
}

describe("LabelMap getOrCreate", () => {
  bench("1 label, 10 keys (cache hit)", () => {
    const map = new LabelMap<number>();
    const sets = makeLabelSets(1, 10);
    // Warm up
    for (const s of sets) map.getOrCreate(s, () => 0);
    // Measure cache hits
    for (let i = 0; i < 10_000; i++) {
      map.getOrCreate(sets[i % 10], () => 0);
    }
  });

  bench("3 labels, 100 keys (cache hit)", () => {
    const map = new LabelMap<number>();
    const sets = makeLabelSets(3, 100);
    for (const s of sets) map.getOrCreate(s, () => 0);
    for (let i = 0; i < 10_000; i++) {
      map.getOrCreate(sets[i % 100], () => 0);
    }
  });

  bench("5 labels, 1000 keys (cache hit)", () => {
    const map = new LabelMap<number>();
    const sets = makeLabelSets(5, 1000);
    for (const s of sets) map.getOrCreate(s, () => 0);
    for (let i = 0; i < 10_000; i++) {
      map.getOrCreate(sets[i % 1000], () => 0);
    }
  });

  bench("3 labels, 100 keys (cold insert)", () => {
    const sets = makeLabelSets(3, 100);
    const map = new LabelMap<number>();
    for (let i = 0; i < 10_000; i++) {
      // New map each 100 inserts to measure insert path
      if (i % 100 === 0 && i > 0) {
        // Create fresh map (can't reset, just re-insert)
      }
      map.getOrCreate(sets[i % 100], () => 0);
    }
  });
});

describe("LabelMap iteration", () => {
  bench("iterate 1000 entries", () => {
    const map = new LabelMap<number>();
    const sets = makeLabelSets(3, 1000);
    for (let i = 0; i < 1000; i++) {
      map.getOrCreate(sets[i], () => i);
    }
    let sum = 0;
    for (let round = 0; round < 100; round++) {
      for (const { data } of map) {
        sum += data;
      }
    }
    // Prevent dead code elimination
    if (sum < 0) throw new Error("unreachable");
  });
});
