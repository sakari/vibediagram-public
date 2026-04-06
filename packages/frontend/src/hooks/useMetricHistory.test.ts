import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { SnapshotResult, TaggedMetricSnapshot } from "@diagram/sim-worker";
import type { SimStatus } from "@diagram/sim-worker";
import type { MetricUnit, MetricValue } from "@diagram/sim-model";
import {
  useMetricHistory,
  labelKey,
  humanLabel,
  downsample,
  MAX_POINTS,
  RATE_WINDOW_SIZE,
  type MetricTimePoint,
} from "./useMetricHistory";

// --- Factories ---

function makeMetric(
  overrides: Partial<TaggedMetricSnapshot> & {
    nodeName?: string;
    valueType?: MetricValue["type"];
    rawValue?: number;
    labels?: Record<string, string>;
    unit?: MetricUnit;
  } = {},
): TaggedMetricSnapshot {
  const valueType = overrides.valueType ?? "gauge";
  const rawValue = overrides.rawValue ?? 0;
  return {
    nodeName: overrides.nodeName ?? "nodeA",
    labels: overrides.labels ?? {},
    value: { type: valueType, value: rawValue } as MetricValue,
    unit: overrides.unit ?? "count",
  };
}

function makeSnapshot(
  simTime: number,
  metrics: TaggedMetricSnapshot[],
): SnapshotResult {
  return { simTime, metrics };
}

// --- Pure function tests ---

describe("labelKey", () => {
  it("produces the same key regardless of insertion order", () => {
    const a = labelKey({ z: "1", a: "2" });
    const b = labelKey({ a: "2", z: "1" });
    expect(a).toBe(b);
  });

  it("returns empty object string for empty labels", () => {
    expect(labelKey({})).toBe("{}");
  });
});

describe("humanLabel", () => {
  it("joins label values sorted by key", () => {
    expect(humanLabel({ method: "GET", status: "200" })).toBe("GET/200");
  });

  it("returns empty string for no labels", () => {
    expect(humanLabel({})).toBe("");
  });

  it("returns single value when one label", () => {
    expect(humanLabel({ quantile: "p95" })).toBe("p95");
  });
});

describe("downsample", () => {
  it("keeps even-indexed points and the last point", () => {
    const points: MetricTimePoint[] = [
      { simTime: 0, value: 0 },
      { simTime: 1, value: 1 },
      { simTime: 2, value: 2 },
      { simTime: 3, value: 3 },
      { simTime: 4, value: 4 },
    ];
    downsample(points);
    expect(points).toEqual([
      { simTime: 0, value: 0 },
      { simTime: 2, value: 2 },
      { simTime: 4, value: 4 },
    ]);
  });

  it("preserves last point even if odd-indexed", () => {
    const points: MetricTimePoint[] = [
      { simTime: 0, value: 0 },
      { simTime: 1, value: 1 },
      { simTime: 2, value: 2 },
      { simTime: 3, value: 3 },
    ];
    downsample(points);
    // indices 0, 2 are even; index 3 is last
    expect(points).toEqual([
      { simTime: 0, value: 0 },
      { simTime: 2, value: 2 },
      { simTime: 3, value: 3 },
    ]);
  });
});

// --- Hook tests ---

describe("useMetricHistory", () => {
  it("returns empty map when snapshot is null", () => {
    const { result } = renderHook(() => useMetricHistory(null, "idle"));
    expect(result.current.size).toBe(0);
  });

  it("accumulates gauge values across multiple snapshots", () => {
    const snap1 = makeSnapshot(1, [
      makeMetric({ nodeName: "n1", rawValue: 10 }),
    ]);
    const snap2 = makeSnapshot(2, [
      makeMetric({ nodeName: "n1", rawValue: 20 }),
    ]);

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap1, status: "running" as SimStatus } },
    );

    // After first snapshot: one point.
    const series1 = result.current.get("n1");
    expect(series1).toBeDefined();
    expect(series1![0].points).toHaveLength(1);
    expect(series1![0].points[0]).toEqual({ simTime: 1, value: 10 });

    // After second snapshot: two points.
    rerender({ snapshot: snap2, status: "running" });
    const series2 = result.current.get("n1");
    expect(series2![0].points).toHaveLength(2);
    expect(series2![0].points[1]).toEqual({ simTime: 2, value: 20 });
  });

  it("computes per-second rate for counter metrics", () => {
    const snap1 = makeSnapshot(1, [
      makeMetric({ nodeName: "c1", valueType: "counter", rawValue: 100 }),
    ]);
    const snap2 = makeSnapshot(3, [
      makeMetric({ nodeName: "c1", valueType: "counter", rawValue: 200 }),
    ]);

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap1, status: "running" as SimStatus } },
    );

    // First counter snapshot creates the series but records no point
    // (need at least 2 samples to compute rate).
    const seriesAfter1 = result.current.get("c1");
    expect(seriesAfter1).toBeDefined();
    expect(seriesAfter1![0].points).toHaveLength(0);

    // Second snapshot: rate = (200 - 100) / (3 - 1) = 50/s.
    rerender({ snapshot: snap2, status: "running" });
    const seriesAfter2 = result.current.get("c1");
    expect(seriesAfter2).toBeDefined();
    expect(seriesAfter2![0].points).toHaveLength(1);
    expect(seriesAfter2![0].points[0].value).toBeCloseTo(50);
    expect(seriesAfter2![0].metricType).toBe("counter");
  });

  it("smooths rate over sliding window of RATE_WINDOW_SIZE snapshots", () => {
    // Feed RATE_WINDOW_SIZE + 1 snapshots at 10/s steady rate.
    // Once the ring is full the oldest sample drops off, and the rate
    // should still be ~10/s.
    const snapshots: SnapshotResult[] = [];
    for (let i = 0; i <= RATE_WINDOW_SIZE; i++) {
      snapshots.push(
        makeSnapshot(i, [
          makeMetric({
            nodeName: "c1",
            valueType: "counter",
            rawValue: i * 10,
          }),
        ]),
      );
    }

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      {
        initialProps: {
          snapshot: snapshots[0],
          status: "running" as SimStatus,
        },
      },
    );

    for (let i = 1; i <= RATE_WINDOW_SIZE; i++) {
      rerender({ snapshot: snapshots[i], status: "running" });
    }

    const points = result.current.get("c1")![0].points;
    // All emitted rates should be 10/s (steady state).
    for (const p of points) {
      expect(p.value).toBeCloseTo(10);
    }
  });

  it("produces separate series for different label sets on same node", () => {
    const snap = makeSnapshot(1, [
      makeMetric({
        nodeName: "n1",
        labels: { quantile: "p50" },
        rawValue: 5,
        valueType: "summary",
      }),
      makeMetric({
        nodeName: "n1",
        labels: { quantile: "p99" },
        rawValue: 50,
        valueType: "summary",
      }),
    ]);

    const { result } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap, status: "running" as SimStatus } },
    );

    const seriesArr = result.current.get("n1");
    expect(seriesArr).toHaveLength(2);

    const labels = seriesArr!.map((s) => s.label).sort();
    expect(labels).toEqual(["p50", "p99"]);
  });

  it("clears history when status transitions to idle", () => {
    const snap = makeSnapshot(1, [
      makeMetric({ nodeName: "n1", rawValue: 42 }),
    ]);

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap, status: "running" as SimStatus } },
    );

    expect(result.current.get("n1")).toBeDefined();

    // Transition to idle clears history.
    rerender({ snapshot: snap, status: "idle" });
    expect(result.current.size).toBe(0);
  });

  it("does NOT clear history when status transitions to done", () => {
    const snap = makeSnapshot(1, [
      makeMetric({ nodeName: "n1", rawValue: 42 }),
    ]);

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap, status: "running" as SimStatus } },
    );

    expect(result.current.get("n1")).toBeDefined();

    // Transition to "done" should preserve history.
    rerender({ snapshot: snap, status: "done" });
    expect(result.current.get("n1")).toBeDefined();
    expect(result.current.get("n1")![0].points.length).toBeGreaterThan(0);
  });

  it("caps points at MAX_POINTS and downsamples", () => {
    // Build a snapshot sequence that exceeds MAX_POINTS.
    const metrics = [makeMetric({ nodeName: "n1", rawValue: 1 })];

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      {
        initialProps: {
          snapshot: makeSnapshot(0, metrics),
          status: "running" as SimStatus,
        },
      },
    );

    // Feed MAX_POINTS + 10 snapshots to trigger downsampling.
    for (let i = 1; i <= MAX_POINTS + 10; i++) {
      rerender({
        snapshot: makeSnapshot(i, [
          makeMetric({ nodeName: "n1", rawValue: i }),
        ]),
        status: "running",
      });
    }

    const series = result.current.get("n1");
    expect(series).toBeDefined();
    // After downsampling, should be at or below MAX_POINTS.
    expect(series![0].points.length).toBeLessThanOrEqual(MAX_POINTS);
    // Should still have a meaningful number of points (not all dropped).
    expect(series![0].points.length).toBeGreaterThan(MAX_POINTS / 4);
  });

  it("handles counter rate calculation per label set independently", () => {
    const snap1 = makeSnapshot(1, [
      makeMetric({
        nodeName: "c1",
        valueType: "counter",
        rawValue: 10,
        labels: { method: "GET" },
      }),
      makeMetric({
        nodeName: "c1",
        valueType: "counter",
        rawValue: 100,
        labels: { method: "POST" },
      }),
    ]);
    const snap2 = makeSnapshot(2, [
      makeMetric({
        nodeName: "c1",
        valueType: "counter",
        rawValue: 15,
        labels: { method: "GET" },
      }),
      makeMetric({
        nodeName: "c1",
        valueType: "counter",
        rawValue: 110,
        labels: { method: "POST" },
      }),
    ]);

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap1, status: "running" as SimStatus } },
    );

    rerender({ snapshot: snap2, status: "running" });

    const seriesArr = result.current.get("c1");
    expect(seriesArr).toHaveLength(2);

    const getSeries = seriesArr!.find((s) => s.label === "GET");
    const postSeries = seriesArr!.find((s) => s.label === "POST");

    // GET: (15 - 10) / (2 - 1) = 5/s
    expect(getSeries!.points[0].value).toBeCloseTo(5);
    // POST: (110 - 100) / (2 - 1) = 10/s
    expect(postSeries!.points[0].value).toBeCloseTo(10);
  });

  it("smooths summary values with EMA", () => {
    const alpha = 2 / (RATE_WINDOW_SIZE + 1);

    // First snapshot: summary value = 10
    const snap1 = makeSnapshot(1, [
      makeMetric({
        nodeName: "s1",
        valueType: "summary",
        rawValue: 10,
        unit: "duration",
      }),
    ]);

    const { result, rerender } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap1, status: "running" as SimStatus } },
    );

    // With one sample the smoothed value equals the raw value.
    expect(result.current.get("s1")![0].points[0].value).toBe(10);

    // Second snapshot: summary jumps to 100. EMA = alpha*100 + (1-alpha)*10.
    const snap2 = makeSnapshot(2, [
      makeMetric({
        nodeName: "s1",
        valueType: "summary",
        rawValue: 100,
        unit: "duration",
      }),
    ]);
    rerender({ snapshot: snap2, status: "running" });
    const expected2 = alpha * 100 + (1 - alpha) * 10;
    expect(result.current.get("s1")![0].points[1].value).toBeCloseTo(expected2);

    // Feed many samples at 100; EMA should converge toward 100 smoothly.
    for (let i = 3; i <= RATE_WINDOW_SIZE * 3; i++) {
      rerender({
        snapshot: makeSnapshot(i, [
          makeMetric({
            nodeName: "s1",
            valueType: "summary",
            rawValue: 100,
            unit: "duration",
          }),
        ]),
        status: "running",
      });
    }

    const points = result.current.get("s1")![0].points;
    const lastValue = points[points.length - 1].value;
    // After many samples at 100, EMA should be very close to 100.
    expect(lastValue).toBeCloseTo(100, 0);
    // Each successive point should be >= the previous (monotonically approaching 100).
    for (let i = 2; i < points.length; i++) {
      expect(points[i].value).toBeGreaterThanOrEqual(
        points[i - 1].value - 0.01,
      );
    }
    expect(result.current.get("s1")![0].metricType).toBe("summary");
  });

  it("stores unit and metricType from the snapshot", () => {
    const snap = makeSnapshot(1, [
      makeMetric({
        nodeName: "n1",
        rawValue: 42,
        unit: "duration",
        valueType: "gauge",
      }),
    ]);

    const { result } = renderHook(
      ({
        snapshot,
        status,
      }: {
        snapshot: SnapshotResult | null;
        status: SimStatus;
      }) => useMetricHistory(snapshot, status),
      { initialProps: { snapshot: snap, status: "running" as SimStatus } },
    );

    const series = result.current.get("n1");
    expect(series![0].unit).toBe("duration");
    expect(series![0].metricType).toBe("gauge");
  });
});
