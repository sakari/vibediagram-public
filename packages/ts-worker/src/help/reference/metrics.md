# Metrics Reference

Metrics extend `Node` and appear as diagram nodes. They collect
observable measurements during simulation.

## Counter

Cumulative counter that only goes up.

```typescript
const requests = model.create("requests", metrics.Counter);

// In a Blueprint:
this.params.requests.increment({});
this.params.requests.increment({}, 5); // increment by amount
```

## Gauge

Latest-value gauge for point-in-time measurements.

```typescript
const utilization = model.create<metrics.Gauge<"ratio">>(
  "utilization",
  metrics.Gauge,
  { unit: "ratio" },
);

// In a Blueprint:
this.params.utilization.set({}, 0.75);
```

**Units**: `"count"`, `"byte"`, `"duration"`, `"ratio"`, `"timestamp"`

The unit type parameter is enforced at compile time:
`metrics.Gauge<"ratio">`, `metrics.Gauge<"count">`, etc.

## Summary

Approximate quantile summary for distribution measurements (e.g. latency).

```typescript
const latency = model.create("latency", metrics.Summary);

// In a Blueprint:
this.params.latency.observe({}, responseTime);
```

Summaries compute percentile snapshots (p50, p95, p99) automatically.

## Labels

All metric methods accept a labels object as the first argument.
Labels partition metric values by dimensions:

```typescript
this.params.statusCounts.increment({ status: "200" });
this.params.statusCounts.increment({ status: "503" });
```

Use `{}` (empty labels) when no partitioning is needed.

## Declaring metric params

```typescript
class MyNode extends Blueprint {
  static params = {
    qps: component.ref(metrics.Counter),
    utilization: component.ref(metrics.Gauge),
    latency: component.ref(metrics.Summary),
  };
  declare params: typeof MyNode.params;
}
```

Each `component.ref()` to a metric creates a diagram edge from the
node to the metric, and the metric appears as a child node.
