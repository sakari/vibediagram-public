/**
 * Step-metrics: Counter, Gauge, Summary for simulation observability.
 * Each metric type stores values per label set. Labels are type-level only
 * (specified via generic parameter on model.create); unit is resolved at
 * runtime via the sentinel/thunk pattern.
 */

import { component } from "./sentinel";
import { Node } from "./node";
import { LabelMap } from "./label-map";
import type { StyleRuleDescriptor } from "./style-rule-descriptor";
import type { MetricUnit } from "./unit";

/** Discriminated union for metric value types. */
export type MetricValue =
  | { type: "counter"; value: number }
  | { type: "gauge"; value: number }
  | { type: "summary"; value: number };

/**
 * Snapshot of a single metric series (labels + value) at a point in time.
 * Labels is a union of all labels used in the metric.
 * */
export type MetricSnapshot<
  Unit extends MetricUnit = MetricUnit,
  Labels extends string = string,
> = {
  labels: Record<Labels, string>;
  value: MetricValue;
  unit: Unit;
};

/**
 * Abstract base for metrics. Subclasses implement increment/set/observe and
 * return snapshots via metrics().
 */

/** Params shape for all Metric subclasses (Counter, Gauge, Summary). */
export interface MetricParams<Unit extends MetricUnit = MetricUnit> {
  unit: Unit;
}

/** Params shape for Summary: adds buckets (quantile thresholds) and ring buffer capacity. */
export interface SummaryParams<
  Unit extends MetricUnit = MetricUnit,
> extends MetricParams<Unit> {
  buckets: number[];
  capacity: number;
}

export abstract class Metric<
  Unit extends MetricUnit = MetricUnit,
  Labels extends string = never,
  OutputLabels extends string = never,
> extends Node {
  static defaultStyleRules(): StyleRuleDescriptor[] {
    return [
      {
        name: "default-metric-group",
        match: { type: "metric" },
        style: { display: "group-child" },
      },
    ];
  }

  params: MetricParams<Unit> = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- sentinel pattern: placeholder stands in for Unit at declaration; engine replaces it before use
    unit: component.param("count") as unknown as Unit,
  };

  abstract metrics(): MetricSnapshot<Unit, Labels | OutputLabels>[];
}

/**
 * Cumulative counter. increment adds to the running total per label set.
 */
export class Counter<
  Unit extends MetricUnit = MetricUnit,
  Labels extends string = never,
> extends Metric<Unit, Labels> {
  private data = new LabelMap<{ value: number }>();

  /** Add amount (default 1) to the counter for the given label set. */
  increment(labels: Record<Labels, string>, amount = 1): void {
    const entry = this.data.getOrCreate(
      labels as Record<string, string>,
      () => ({
        value: 0,
      }),
    );
    entry.value += amount;
  }

  metrics(): MetricSnapshot<Unit, Labels>[] {
    const result: MetricSnapshot<Unit, Labels>[] = [];
    for (const { labels, data } of this.data) {
      result.push({
        labels: labels as Record<Labels, string>,
        value: { type: "counter", value: data.value },
        unit: this.params.unit,
      });
    }
    return result;
  }
}

/**
 * Latest-value gauge. set overwrites the stored value per label set.
 */
export class Gauge<
  Unit extends MetricUnit = MetricUnit,
  Labels extends string = never,
> extends Metric<Unit, Labels> {
  private data = new LabelMap<{ value: number }>();

  /** Store value for the given label set. */
  set(labels: Record<Labels, string>, value: number): void {
    const entry = this.data.getOrCreate(
      labels as Record<string, string>,
      () => ({
        value: 0,
      }),
    );
    entry.value = value;
  }

  metrics(): MetricSnapshot<Unit, Labels>[] {
    const result: MetricSnapshot<Unit, Labels>[] = [];
    for (const { labels, data } of this.data) {
      result.push({
        labels: labels as Record<Labels, string>,
        value: { type: "gauge", value: data.value },
        unit: this.params.unit,
      });
    }
    return result;
  }
}

/**
 * Approximate quantile summary. observe adds values to a ring buffer per label set.
 * Quantiles computed from sorted buffer; when full, overwrites oldest.
 * Returns Prometheus-style per-quantile values .
 */
export class Summary<
  Unit extends MetricUnit = MetricUnit,
  Labels extends string = never,
> extends Metric<Unit, Labels, "quantile"> {
  private data = new LabelMap<{
    buf: number[];
    writeIdx: number;
    full: boolean;
    /** Cached quantile snapshots returned when no new observations exist. */
    cached: MetricSnapshot<Unit, Labels | "quantile">[];
  }>();

  override params: SummaryParams<Unit> = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- sentinel pattern: placeholder stands in for Unit at declaration; engine replaces it before use
    unit: component.param("duration") as unknown as Unit,
    buckets: component.array(component.capacity(), [0.5, 0.9, 0.99]),
    capacity: component.capacity(1000),
  };

  /** Add value to the ring buffer for the given label set. */
  observe(labels: Record<Labels, string>, value: number): void {
    const capacity = this.params.capacity;
    const entry = this.data.getOrCreate(
      labels as Record<string, string>,
      () => ({
        buf: new Array<number>(capacity),
        writeIdx: 0,
        full: false,
        cached: [],
      }),
    );
    entry.buf[entry.writeIdx] = value;
    entry.writeIdx = (entry.writeIdx + 1) % capacity;
    if (entry.writeIdx === 0) entry.full = true;
  }

  /**
   *
   * Returns observer values for labelset and quantile label.
   * For 0 quantile, returns the lowest value observed.
   * For 1 quantile, returns the highest value observed.
   * For other quantiles returns the value at the quantile index.
   */
  metrics(): MetricSnapshot<Unit, Labels | "quantile">[] {
    const result: MetricSnapshot<Unit, Labels | "quantile">[] = [];
    for (const { labels, data } of this.data) {
      const n = data.full ? this.params.capacity : data.writeIdx;
      if (n === 0) {
        // No new observations since last poll — return cached values
        result.push(...data.cached);
        continue;
      }
      const sorted = data.buf.slice(0, n).sort((a, b) => a - b);
      const idx = (p: number) => Math.max(0, Math.ceil(p * n) - 1);

      data.cached = [];
      for (const quantile of this.params.buckets) {
        const snap: MetricSnapshot<Unit, Labels | "quantile"> = {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- spread of Record<string,string> with added quantile key; TypeScript cannot verify Labels keys are present
          labels: {
            ...labels,
            quantile: String(quantile),
          } as unknown as Record<Labels | "quantile", string>,
          value: { type: "summary", value: sorted[idx(quantile)] },
          unit: this.params.unit,
        };
        data.cached.push(snap);
        result.push(snap);
      }
      // Reset buffer so quantiles only reflect observations since this poll
      data.writeIdx = 0;
      data.full = false;
    }
    return result;
  }
}
