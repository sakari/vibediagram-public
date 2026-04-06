import { describe, it, expect } from "vitest";
import { Node } from "./node";
import { isSentinel } from "./sentinel";
import { Counter, Gauge, Summary, Metric } from "./metric";
import type { MetricUnit } from "./unit";

describe("metric", () => {
  describe("metric-counter", () => {
    it("increment increments by 1 by default", () => {
      const c = new Counter();
      c.increment({ path: "/" });
      const snapshots = c.metrics();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].labels).toEqual({ path: "/" });
      expect(snapshots[0].value).toEqual({ type: "counter", value: 1 });
    });

    it("increment adds specified amount", () => {
      const c = new Counter();
      c.increment({ path: "/" }, 3);
      c.increment({ path: "/" }, 5);
      const snapshots = c.metrics();
      expect(snapshots[0].value).toEqual({ type: "counter", value: 8 });
    });

    it("tracks multiple label sets independently", () => {
      const c = new Counter<MetricUnit, "path" | "method">();
      c.increment({ path: "/", method: "GET" }, 10);
      c.increment({ path: "/", method: "POST" }, 20);
      c.increment({ path: "/api", method: "GET" }, 5);
      const snapshots = c.metrics();
      expect(snapshots).toHaveLength(3);
      const get = snapshots.find(
        (s) => s.labels.method === "GET" && s.labels.path === "/",
      );
      const post = snapshots.find(
        (s) => s.labels.method === "POST" && s.labels.path === "/",
      );
      const api = snapshots.find((s) => s.labels.path === "/api");
      expect(get?.value).toEqual({ type: "counter", value: 10 });
      expect(post?.value).toEqual({ type: "counter", value: 20 });
      expect(api?.value).toEqual({ type: "counter", value: 5 });
    });
  });

  describe("metric-gauge", () => {
    it("set stores latest value per label set", () => {
      const g = new Gauge();
      g.set({ zone: "a" }, 42);
      g.set({ zone: "a" }, 100);
      const snapshots = g.metrics();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].labels).toEqual({ zone: "a" });
      expect(snapshots[0].value).toEqual({ type: "gauge", value: 100 });
    });

    it("tracks multiple label sets independently", () => {
      const g = new Gauge<MetricUnit, "zone">();
      g.set({ zone: "a" }, 10);
      g.set({ zone: "b" }, 20);
      g.set({ zone: "a" }, 15);
      const snapshots = g.metrics();
      expect(snapshots).toHaveLength(2);
      const a = snapshots.find((s) => s.labels.zone === "a");
      const b = snapshots.find((s) => s.labels.zone === "b");
      expect(a?.value).toEqual({ type: "gauge", value: 15 });
      expect(b?.value).toEqual({ type: "gauge", value: 20 });
    });
  });

  describe("metric-summary", () => {
    it("returns the lowest value observed for quantile 0", () => {
      const s = new Summary();
      s.params.buckets = [0];
      s.params.capacity = 4096;
      s.observe({}, 10);
      s.observe({}, 5);
      s.observe({}, 20);
      const snapshots = s.metrics();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].value).toEqual({ type: "summary", value: 5 });
    });
    it("returns the highest value observed for quantile 1", () => {
      const s = new Summary();
      s.params.buckets = [1];
      s.params.capacity = 4096;
      s.observe({}, 10);
      s.observe({}, 5);
      s.observe({}, 20);
      const snapshots = s.metrics();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].value).toEqual({ type: "summary", value: 20 });
    });
    it("returns the middle value observed for quantile 0.5", () => {
      const s = new Summary();
      s.params.buckets = [0.5];
      s.params.capacity = 4096;
      for (let i = 1; i <= 100; i++) s.observe({}, i);
      const snapshots = s.metrics();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].value).toEqual({ type: "summary", value: 50 });
    });
    it("ring buffer wraps at capacity", () => {
      const s = new Summary();
      s.params.buckets = [0, 1];
      s.params.capacity = 5;
      s.observe({}, 1);
      s.observe({}, 2);
      s.observe({}, 3);
      s.observe({}, 4);
      s.observe({}, 5);
      s.observe({}, 100);
      s.observe({}, 99);
      const snapshots = s.metrics();
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].value).toEqual({ type: "summary", value: 3 });
      expect(snapshots[1].value).toEqual({ type: "summary", value: 100 });
      // Buffer is reset after metrics(), so a second call returns cached values
      const after = s.metrics();
      expect(after).toHaveLength(2);
      expect(after[0].value).toEqual({ type: "summary", value: 3 });
      expect(after[1].value).toEqual({ type: "summary", value: 100 });
    });
    it("metrics() resets buffer so next poll only has new observations", () => {
      const s = new Summary();
      s.params.buckets = [0.5];
      s.params.capacity = 100;
      for (let i = 1; i <= 10; i++) s.observe({}, i);
      const first = s.metrics();
      expect(first).toHaveLength(1);
      expect(first[0].value).toEqual({ type: "summary", value: 5 });
      // Observe a higher range; quantiles should only reflect these new values
      for (let i = 90; i <= 100; i++) s.observe({}, i);
      const second = s.metrics();
      expect(second).toHaveLength(1);
      expect(second[0].value).toEqual({ type: "summary", value: 95 });
    });
  });

  describe("metric-labels", () => {
    it("uses typechecking to prevent invalid labels for counters", () => {
      const c = new Counter<MetricUnit, "a">();
      c.increment({ a: "1" }, 5);
      // @ts-expect-error - invalid label set
      c.increment({ a: "1", b: "2", c: "3" }, 5);
    });
    it("uses typechecking to prevent invalid labels for summaries", () => {
      const s = new Summary<MetricUnit, "a">();
      s.params.buckets = [0.5];
      s.params.capacity = 4096;
      // @ts-expect-error - invalid bucket
      s.observe({ b: "1" }, 5);
    });

    it("uses buckets quantiles for summaries", () => {
      const s = new Summary();
      s.params.buckets = [0.5];
      s.params.capacity = 4096;
      s.observe({ a: "1" }, 5);
      const snapshots = s.metrics();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].labels.quantile).toBe("0.5");
    });

    it("different label key orderings map to same series", () => {
      const c = new Counter<MetricUnit, "a" | "b">();
      c.increment({ a: "1", b: "2" }, 5);
      c.increment({ b: "2", a: "1" }, 3);
      const snapshots = c.metrics();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].labels.a).toBe("1");
      expect(snapshots[0].labels.b).toBe("2");
      expect(snapshots[0].value).toEqual({ type: "counter", value: 8 });
    });
  });

  describe("Metric.defaultStyleRules", () => {
    it("returns a group-child rule for metric type", () => {
      const rules = Metric.defaultStyleRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].match).toEqual({ type: "metric" });
      expect(rules[0].style).toEqual({ display: "group-child" });
    });
  });

  describe("metric-is-node", () => {
    it("new Counter() instanceof Node is true", () => {
      expect(new Counter() instanceof Node).toBe(true);
    });

    it("new Counter() instanceof Metric is true", () => {
      expect(new Counter() instanceof Metric).toBe(true);
    });

    it("Counter has params with unit sentinel only", () => {
      const c = new Counter();
      expect(Object.keys(c.params)).toEqual(["unit"]);
    });
  });

  describe("unit support", () => {
    it("type-checks incompatible units", () => {
      function acceptCount(_c: Counter<"count", "s">) {}
      const byteCounter = new Counter<"byte", "s">();
      // @ts-expect-error — Counter<"byte", "s"> is not assignable to Counter<"count", "s">
      acceptCount(byteCounter);
    });

    it("type-checks invalid unit strings", () => {
      // @ts-expect-error — "invalid" is not assignable to MetricUnit
      type _Bad = Counter<"invalid", "s">;
    });

    it("includes unit in snapshots", () => {
      const counter = new Counter<"byte", "status">();
      counter.params = { unit: "byte" as const };
      counter.increment({ status: "ok" }, 1536);
      const snaps = counter.metrics();
      expect(snaps[0].unit).toBe("byte");
    });

    it("Counter has params with unit sentinel", () => {
      const c = new Counter();
      expect(c.params.unit).toBeDefined();
      expect(isSentinel(c.params.unit)).toBe(true);
    });

    it("Gauge includes unit in snapshots", () => {
      const gauge = new Gauge<"ratio", "status">();
      gauge.params = { unit: "ratio" as const };
      gauge.set({ status: "cpu" }, 0.75);
      const snaps = gauge.metrics();
      expect(snaps[0].unit).toBe("ratio");
    });

    it("Summary includes unit in snapshots", () => {
      const summary = new Summary<"duration", "path">();
      summary.params = {
        unit: "duration" as const,
        buckets: [0.5, 0.99],
        capacity: 100,
      };
      summary.observe({ path: "/api" }, 0.25);
      const snaps = summary.metrics();
      expect(snaps.length).toBeGreaterThan(0);
      for (const snap of snaps) {
        expect(snap.unit).toBe("duration");
      }
    });

    it("Summary.metrics() returns empty array when no observations exist for a label set", () => {
      const summary = new Summary();
      summary.params = {
        unit: "duration" as const,
        buckets: [0.5, 0.99],
        capacity: 100,
      };
      // No observe() calls — metrics() should return empty
      expect(summary.metrics()).toEqual([]);
    });
  });
});
