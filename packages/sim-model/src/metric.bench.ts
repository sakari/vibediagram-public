import { bench, describe } from "vitest";
import { Counter, Gauge, Summary } from "./metric";

// Metric instances need params.unit set manually (bypassing sentinel wiring)
function makeCounter(): Counter {
  const c = new Counter();
  c.params = { unit: "count" };
  return c;
}

function makeGauge(): Gauge {
  const g = new Gauge();
  g.params = { unit: "ratio" };
  return g;
}

function makeSummary(capacity: number): Summary {
  const s = new Summary();
  s.params = {
    unit: "duration",
    buckets: [0.5, 0.9, 0.99],
    capacity,
  };
  return s;
}

describe("Counter", () => {
  bench("increment single label set x10k", () => {
    const c = makeCounter();
    const labels = { method: "GET" };
    for (let i = 0; i < 10_000; i++) {
      c.increment(labels);
    }
  });

  bench("increment 100 label sets x10k", () => {
    const c = makeCounter();
    const labelSets = Array.from({ length: 100 }, (_, i) => ({
      method: `m${String(i)}`,
    }));
    for (let i = 0; i < 10_000; i++) {
      c.increment(labelSets[i % 100]);
    }
  });
});

describe("Gauge", () => {
  bench("set single label set x10k", () => {
    const g = makeGauge();
    const labels = { pool: "main" };
    for (let i = 0; i < 10_000; i++) {
      g.set(labels, i / 10_000);
    }
  });
});

describe("Summary", () => {
  bench("observe capacity=1000 x10k", () => {
    const s = makeSummary(1000);
    const labels = { endpoint: "/api" };
    for (let i = 0; i < 10_000; i++) {
      s.observe(labels, Math.random());
    }
  });

  bench("metrics() capacity=1000 (snapshot)", () => {
    const s = makeSummary(1000);
    const labels = { endpoint: "/api" };
    for (let i = 0; i < 1000; i++) {
      s.observe(labels, Math.random());
    }
    for (let i = 0; i < 100; i++) {
      s.metrics();
    }
  });

  bench("metrics() capacity=10000 (snapshot)", () => {
    const s = makeSummary(10_000);
    const labels = { endpoint: "/api" };
    for (let i = 0; i < 10_000; i++) {
      s.observe(labels, Math.random());
    }
    for (let i = 0; i < 100; i++) {
      s.metrics();
    }
  });
});
