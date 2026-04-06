/**
 * Types and hook for tracking metric values over simulation time.
 *
 * MetricTimeSeries captures a labeled sequence of (simTime, value) pairs
 * so they can be plotted in a sparkline chart inside metric nodes.
 *
 * Counter metrics are converted to per-second rates. Gauge and summary
 * metrics store raw values. History is capped at MAX_POINTS and
 * downsampled when exceeded.
 */
import { useRef, useMemo } from "react";
import type { MetricUnit } from "@diagram/sim-model";
import type { SnapshotResult, SimStatus } from "@diagram/sim-worker";

/** A single data point in a metric time series. */
export interface MetricTimePoint {
  simTime: number;
  value: number;
}

/**
 * A labeled series of metric data points, ready for charting.
 * Each series corresponds to one tag-combination of a metric.
 */
export interface MetricTimeSeries {
  label: string;
  points: MetricTimePoint[];
  unit: MetricUnit;
  metricType: "counter" | "gauge" | "summary";
}

/**
 * Outer map keyed by nodeName. Each node maps to one MetricTimeSeries
 * per unique label combination observed for that metric.
 */
type MetricHistoryMap = Map<string, MetricTimeSeries[]>;

/** Maximum number of points kept per series before downsampling. */
export const MAX_POINTS = 500;

/**
 * Derive a stable key from a labels record by sorting keys alphabetically
 * and JSON-stringifying. Used to group snapshots into the same time series.
 */
export function labelKey(labels: Record<string, string>): string {
  const sorted = Object.keys(labels).sort();
  const obj: Record<string, string> = {};
  for (const k of sorted) {
    obj[k] = labels[k];
  }
  return JSON.stringify(obj);
}

/**
 * Build a human-readable label from a labels record by joining label
 * values with "/". Returns "" when labels is empty.
 */
export function humanLabel(labels: Record<string, string>): string {
  const sorted = Object.keys(labels).sort();
  return sorted.map((k) => labels[k]).join("/");
}

/**
 * Downsample a points array by dropping every other point (keeping the
 * first and last). Mutates the array in place for efficiency.
 */
export function downsample(points: MetricTimePoint[]): void {
  const kept: MetricTimePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    // Keep even-indexed points and always keep the last point.
    if (i % 2 === 0 || i === points.length - 1) {
      kept.push(points[i]);
    }
  }
  points.length = 0;
  points.push(...kept);
}

/**
 * Number of snapshots in the sliding window for counter rate smoothing.
 * Rate is computed as (newest - oldest) / (newestTime - oldestTime) across
 * the buffer. At ~60fps snapshot polling this covers ~0.25s of wall time,
 * smoothing discrete-event noise without going stale at low speed.
 */
export const RATE_WINDOW_SIZE = 16;

/** A single snapshot sample in the counter sliding window. */
interface CounterSample {
  rawValue: number;
  simTime: number;
}

/** Ring buffer of recent counter samples for sliding-window rate calculation. */
interface CounterRing {
  buf: CounterSample[];
  /** Next write index (wraps around). */
  writeIdx: number;
  /** Number of samples written (capped at buf.length). */
  count: number;
}

function createRing(): CounterRing {
  return {
    buf: new Array<CounterSample>(RATE_WINDOW_SIZE),
    writeIdx: 0,
    count: 0,
  };
}

function pushSample(ring: CounterRing, sample: CounterSample): void {
  ring.buf[ring.writeIdx] = sample;
  ring.writeIdx = (ring.writeIdx + 1) % ring.buf.length;
  if (ring.count < ring.buf.length) ring.count++;
}

function oldestSample(ring: CounterRing): CounterSample {
  if (ring.count < ring.buf.length) return ring.buf[0];
  return ring.buf[ring.writeIdx];
}

function newestSample(ring: CounterRing): CounterSample {
  const idx = (ring.writeIdx - 1 + ring.buf.length) % ring.buf.length;
  return ring.buf[idx];
}

/**
 * Mutable state stored in a ref to avoid re-creating on every render.
 * Contains the history map and counter sliding-window tracking.
 */
interface HistoryState {
  /** The metric history map (nodeName -> series[]). */
  map: MetricHistoryMap;
  /**
   * Index from "nodeName\0labelKey" to its MetricTimeSeries.
   * Avoids linear scans on every snapshot.
   */
  seriesIndex: Map<string, MetricTimeSeries>;
  /** Sliding window ring buffers keyed by "nodeName\0labelKey". */
  counterPrev: Map<string, CounterRing>;
  /** EMA state for summary value smoothing. */
  summaryPrev: Map<string, SummaryEma>;
}

/**
 * Compute counter rate from a sliding window of recent snapshots.
 * Returns the rate to emit, or null to skip (not enough samples or
 * counter reset).
 */
function counterRate(
  counterPrev: Map<string, CounterRing>,
  compositeKey: string,
  rawValue: number,
  simTime: number,
): number | null {
  let ring = counterPrev.get(compositeKey);
  if (!ring) {
    ring = createRing();
    counterPrev.set(compositeKey, ring);
  }

  // Detect counter reset (value decreased).
  if (ring.count > 0 && rawValue < newestSample(ring).rawValue) {
    ring = createRing();
    counterPrev.set(compositeKey, ring);
  }

  pushSample(ring, { rawValue, simTime });

  if (ring.count < 2) return null;

  const oldest = oldestSample(ring);
  const newest = newestSample(ring);
  const dt = newest.simTime - oldest.simTime;
  if (dt === 0) return null;

  return (newest.rawValue - oldest.rawValue) / dt;
}

/** EMA smoothing factor — matches the effective window of RATE_WINDOW_SIZE. */
const SUMMARY_EMA_ALPHA = 2 / (RATE_WINDOW_SIZE + 1);

/** Smoothed summary value per composite key. */
interface SummaryEma {
  value: number;
  initialised: boolean;
}

/**
 * Smooth a summary metric value with an exponential moving average.
 * EMA reacts quickly to level shifts without the step-discontinuities
 * of a simple sliding-window average.
 */
function summarySmooth(
  summaryPrev: Map<string, SummaryEma>,
  compositeKey: string,
  rawValue: number,
): number {
  let ema = summaryPrev.get(compositeKey);
  if (!ema) {
    ema = { value: rawValue, initialised: true };
    summaryPrev.set(compositeKey, ema);
    return rawValue;
  }

  ema.value =
    SUMMARY_EMA_ALPHA * rawValue + (1 - SUMMARY_EMA_ALPHA) * ema.value;
  return ema.value;
}

function createEmptyState(): HistoryState {
  return {
    map: new Map(),
    seriesIndex: new Map(),
    counterPrev: new Map(),
    summaryPrev: new Map(),
  };
}

/**
 * Track metric time series across simulation snapshots.
 *
 * On each new snapshot, extracts metrics and appends data points to
 * per-node, per-label series. Counter metrics are converted to per-second
 * rates. History clears when status transitions to "idle".
 *
 * Returns a MetricHistoryMap keyed by nodeName. The returned map reference
 * changes (via a version counter) whenever new data is appended.
 */
export function useMetricHistory(
  snapshot: SnapshotResult | null,
  status: SimStatus,
): MetricHistoryMap {
  const stateRef = useRef(createEmptyState());
  const prevStatusRef = useRef<SimStatus>(status);
  const prevSnapshotRef = useRef<SnapshotResult | null>(null);

  // Monotonic version counter. Bumped after processing new data or clearing.
  // useMemo depends on this to produce a fresh Map reference.
  const versionRef = useRef(0);

  // Clear history when status transitions to "idle".
  if (status === "idle" && prevStatusRef.current !== "idle") {
    stateRef.current = createEmptyState();
    // Mark the current snapshot as already processed so it doesn't
    // get re-ingested into the freshly cleared state below.
    prevSnapshotRef.current = snapshot;
    versionRef.current += 1;
  }
  prevStatusRef.current = status;

  // Process new snapshot data.
  if (snapshot && snapshot !== prevSnapshotRef.current) {
    prevSnapshotRef.current = snapshot;

    const state = stateRef.current;
    const { map, seriesIndex, counterPrev, summaryPrev } = state;
    const simTime = snapshot.simTime;

    for (const m of snapshot.metrics) {
      const lKey = labelKey(m.labels);
      const compositeKey = `${m.nodeName}\0${lKey}`;

      // Find or create the series for this (node, label) pair.
      let series = seriesIndex.get(compositeKey);
      if (!series) {
        series = {
          label: humanLabel(m.labels),
          points: [],
          unit: m.unit,
          metricType: m.value.type,
        };
        seriesIndex.set(compositeKey, series);

        // Also register in the outer map.
        let seriesArr = map.get(m.nodeName);
        if (!seriesArr) {
          seriesArr = [];
          map.set(m.nodeName, seriesArr);
        }
        seriesArr.push(series);
      }

      // Compute the value to store.
      let value: number;
      if (m.value.type === "counter") {
        const rate = counterRate(
          counterPrev,
          compositeKey,
          m.value.value,
          simTime,
        );
        if (rate === null) continue;
        value = rate;
      } else if (m.value.type === "summary") {
        value = summarySmooth(summaryPrev, compositeKey, m.value.value);
      } else {
        value = m.value.value;
      }

      series.points.push({ simTime, value });

      // Downsample if exceeding the cap.
      if (series.points.length > MAX_POINTS) {
        downsample(series.points);
      }
    }

    versionRef.current += 1;
  }

  // Capture version as a local for the useMemo dependency.
  const version = versionRef.current;
  // Return a fresh Map snapshot keyed on version so React can diff properly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Map(stateRef.current.map), [version]);
}
