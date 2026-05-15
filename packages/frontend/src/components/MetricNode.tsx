import {
  Handle,
  Position,
  type DiagramNodeComponentProps,
} from "@diagram/diagram-view";
import { formatMetricValue } from "@diagram/sim-model";
import type { TaggedMetricSnapshot } from "@diagram/sim-worker";
import MetricChart from "./MetricChart";
import type { MetricTimeSeries } from "../hooks/useMetricHistory";
import { humanLabel } from "../hooks/useMetricHistory";

function isTaggedMetricSnapshotArray(
  value: unknown,
): value is TaggedMetricSnapshot[] {
  return Array.isArray(value);
}

function isMetricTimeSeriesArray(value: unknown): value is MetricTimeSeries[] {
  return Array.isArray(value);
}

/** Render the metric label with an optional description tooltip. */
function MetricLabel({
  label,
  description,
}: {
  readonly label: string;
  readonly description: string | undefined;
}) {
  if (description) {
    return (
      <span className="diagram-label-hint" title={description}>
        {label}
      </span>
    );
  }
  return <span>{label}</span>;
}

/**
 * Borderless node for metric children inside Blueprint groups.
 * Shows the metric name and its current value(s).
 *
 * ReactFlow passes NodeProps at runtime — label lives in data.label,
 * metric snapshots in data.metrics (injected by DiagramWorkspace).
 */
function MetricNode({ data }: DiagramNodeComponentProps) {
  const label = typeof data?.label === "string" ? data.label : "";
  const description =
    typeof data?.description === "string" && data.description.length > 0
      ? data.description
      : undefined;
  const metricsRaw = data?.metrics;
  const metrics: TaggedMetricSnapshot[] = isTaggedMetricSnapshotArray(
    metricsRaw,
  )
    ? metricsRaw
    : [];
  const historyRaw = data?.history;
  const history: MetricTimeSeries[] = isMetricTimeSeriesArray(historyRaw)
    ? historyRaw
    : [];

  const timeWindow =
    typeof data?.timeWindow === "number" ? data.timeWindow : null;
  const hasChart = history.length > 0;

  return (
    <div
      style={{
        padding: "2px 8px",
        fontSize: 12,
        fontFamily: "system-ui, sans-serif",
        color: "var(--node-text, #b0b0c0)",
        overflow: "hidden",
        minWidth: 220,
        minHeight: 100,
        background: "var(--metric-node-bg, #141420)",
        borderRadius: 4,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <MetricLabel label={label} description={description} />
        {!hasChart && metrics.length > 0 && (
          <span
            style={{ fontVariantNumeric: "tabular-nums", color: "#e0e0e0" }}
          >
            {metrics
              .map((m) => formatMetricValue(m.value.value, m.unit))
              .join(" / ")}
          </span>
        )}
      </div>
      <MetricChart
        series={history}
        timeWindow={timeWindow}
        placeholder
        placeholderLabels={
          metrics.length > 0
            ? metrics.map((m) => ({
                label: humanLabel(m.labels),
                unit: m.unit,
              }))
            : undefined
        }
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default MetricNode;
