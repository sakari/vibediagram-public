/**
 * Compact chart for metric time series with labeled axes.
 *
 * Renders one or more MetricTimeSeries as SVG line paths using visx.
 * Designed to fit inside metric nodes with labeled x (simTime) and y (value) axes.
 * When multiple series are present a compact legend is shown below the chart.
 */
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { formatMetricValue, type MetricUnit } from "@diagram/sim-model";

import type { MetricTimeSeries } from "../hooks/useMetricHistory";

const COLORS = [
  "#7eb5ff",
  "#ff7eb5",
  "#7effb5",
  "#ffb57e",
  "#b57eff",
  "#5effe0",
];

const CHART_WIDTH = 220;
const CHART_HEIGHT = 100;
const MARGIN = { top: 6, right: 8, bottom: 20, left: 42 };
const LEGEND_HEIGHT = 16;

/** Pick a color from the palette, wrapping around if needed. */
function seriesColor(index: number): string {
  return COLORS[index % COLORS.length];
}

/** Format a simTime value for the x-axis label. */
function formatTime(seconds: number): string {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)}m`;
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  return `${(seconds * 1000).toFixed(0)}ms`;
}

/** Pick ~3 nice tick values spanning the domain. */
function ticks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const step = (max - min) / (count - 1);
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(min + step * i);
  }
  return result;
}

/** Label and unit pair used to render a placeholder chart before data arrives. */
interface PlaceholderLabel {
  label: string;
  unit: MetricUnit;
}

interface MetricChartProps {
  series: MetricTimeSeries[];
  timeWindow?: number | null;
  /** When true and series is empty, renders a chart skeleton with axis labels. */
  placeholder?: boolean;
  /** Optional labels/units for the placeholder legend. */
  placeholderLabels?: PlaceholderLabel[];
}

/**
 * Renders an empty chart skeleton with axis labels and grid lines.
 * Maintains the same dimensions as a real chart so the node does not
 * jump in size when data arrives.
 */
function PlaceholderChart({
  placeholderLabels,
}: {
  placeholderLabels?: PlaceholderLabel[];
}) {
  const labels = placeholderLabels ?? [];
  const showLegend = labels.length > 1;
  const totalHeight = CHART_HEIGHT + (showLegend ? LEGEND_HEIGHT : 0);
  const innerWidth = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  const unit: MetricUnit = labels.length > 0 ? labels[0].unit : "count";
  const placeholderTicks = [0, 0.5, 1];

  const xScale = scaleLinear({
    domain: [0, 1],
    range: [0, innerWidth],
  });
  const yScale = scaleLinear({
    domain: [0, 1],
    range: [innerHeight, 0],
  });

  return (
    <svg
      width={CHART_WIDTH}
      height={totalHeight}
      role="img"
      aria-label="metric chart"
      style={{ display: "block", maxWidth: "100%" }}
    >
      <Group left={MARGIN.left} top={MARGIN.top}>
        {/* Y-axis ticks and labels */}
        {placeholderTicks.map((v) => (
          <g key={`y-${String(v)}`}>
            <line
              x1={0}
              x2={innerWidth}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="#3a3a5a"
              strokeDasharray="2,2"
            />
            <text
              x={-4}
              y={yScale(v)}
              fontSize={9}
              fill="#7a7a9a"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatMetricValue(v, unit)}
            </text>
          </g>
        ))}

        {/* X-axis ticks and labels */}
        {placeholderTicks.map((t) => (
          <text
            key={`x-${String(t)}`}
            x={xScale(t)}
            y={innerHeight + 14}
            fontSize={9}
            fill="#7a7a9a"
            textAnchor="middle"
          >
            {formatTime(t)}
          </text>
        ))}
      </Group>

      {showLegend && (
        <Group top={CHART_HEIGHT + 2} left={MARGIN.left}>
          {labels.map((pl, i) => {
            const xOffset = i * 70;
            return (
              <g
                key={pl.label || String(i)}
                transform={`translate(${String(xOffset)}, 0)`}
              >
                <circle cx={4} cy={5} r={3} fill={seriesColor(i)} />
                <text
                  x={10}
                  y={9}
                  fontSize={10}
                  fill="#9090a0"
                  dominantBaseline="middle"
                >
                  {pl.label}
                </text>
              </g>
            );
          })}
        </Group>
      )}
    </svg>
  );
}

function MetricChart({
  series,
  timeWindow,
  placeholder,
  placeholderLabels,
}: MetricChartProps) {
  const filtered = timeWindow
    ? (() => {
        // Find the global max time across all series to anchor the window.
        let globalMax = -Infinity;
        for (const s of series) {
          for (const p of s.points) {
            if (p.simTime > globalMax) globalMax = p.simTime;
          }
        }
        const cutoff = globalMax - timeWindow;
        return series.map((s) => ({
          ...s,
          points: s.points.filter((p) => p.simTime >= cutoff),
        }));
      })()
    : series;

  const nonEmpty = filtered.filter((s) => s.points.length > 0);

  if (nonEmpty.length === 0) {
    if (!placeholder) {
      return null;
    }
    return <PlaceholderChart placeholderLabels={placeholderLabels} />;
  }

  const showLegend = nonEmpty.length > 1;
  const totalHeight = CHART_HEIGHT + (showLegend ? LEGEND_HEIGHT : 0);
  const innerWidth = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  // Compute domains across all visible series.
  let timeMin = Infinity;
  let timeMax = -Infinity;
  let valMin = Infinity;
  let valMax = -Infinity;
  for (const s of nonEmpty) {
    for (const p of s.points) {
      if (p.simTime < timeMin) timeMin = p.simTime;
      if (p.simTime > timeMax) timeMax = p.simTime;
      if (p.value < valMin) valMin = p.value;
      if (p.value > valMax) valMax = p.value;
    }
  }

  const xScale = scaleLinear({
    domain: [timeMin, timeMax],
    range: [0, innerWidth],
  });

  // Ensure y-domain has nonzero range so a flat line centers vertically.
  const yMax = valMax === valMin ? valMin + 1 : valMax;
  const yScale = scaleLinear({
    domain: [valMin, yMax],
    range: [innerHeight, 0],
  });

  const unit: MetricUnit = nonEmpty[0].unit;
  const xTicks = ticks(timeMin, timeMax, 3);
  const yTicks = ticks(valMin, yMax, 3);

  return (
    <svg
      width={CHART_WIDTH}
      height={totalHeight}
      role="img"
      aria-label="metric chart"
      style={{ display: "block", maxWidth: "100%" }}
    >
      <Group left={MARGIN.left} top={MARGIN.top}>
        {/* Y-axis ticks and labels */}
        {yTicks.map((v) => (
          <g key={`y-${String(v)}`}>
            <line
              x1={0}
              x2={innerWidth}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="#3a3a5a"
              strokeDasharray="2,2"
            />
            <text
              x={-4}
              y={yScale(v)}
              fontSize={9}
              fill="#7a7a9a"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatMetricValue(v, unit)}
            </text>
          </g>
        ))}

        {/* X-axis ticks and labels */}
        {xTicks.map((t) => (
          <text
            key={`x-${String(t)}`}
            x={xScale(t)}
            y={innerHeight + 14}
            fontSize={9}
            fill="#7a7a9a"
            textAnchor="middle"
          >
            {formatTime(t)}
          </text>
        ))}

        {/* Data lines */}
        {nonEmpty.map((s, i) => {
          const color = seriesColor(i);

          if (s.points.length === 1) {
            const pt = s.points[0];
            return (
              <circle
                key={s.label || String(i)}
                cx={xScale(pt.simTime)}
                cy={yScale(pt.value)}
                r={2}
                fill={color}
              />
            );
          }

          return (
            <LinePath
              key={s.label || String(i)}
              data={s.points}
              x={(d) => xScale(d.simTime)}
              y={(d) => yScale(d.value)}
              stroke={color}
              strokeWidth={1.5}
            />
          );
        })}
      </Group>

      {showLegend && (
        <Group top={CHART_HEIGHT + 2} left={MARGIN.left}>
          {nonEmpty.map((s, i) => {
            const xOffset = i * 70;
            return (
              <g
                key={s.label || String(i)}
                transform={`translate(${String(xOffset)}, 0)`}
              >
                <circle cx={4} cy={5} r={3} fill={seriesColor(i)} />
                <text
                  x={10}
                  y={9}
                  fontSize={10}
                  fill="#9090a0"
                  dominantBaseline="middle"
                >
                  {s.label}
                </text>
              </g>
            );
          })}
        </Group>
      )}
    </svg>
  );
}

export default MetricChart;
