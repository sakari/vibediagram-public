/**
 * Metric unit taxonomy — the closed set of unit categories that a metric can declare.
 *
 * Each member drives unit-aware formatting in the UI via `formatMetricValue`.
 * The union is intentionally small; adding a new unit requires updating
 * `formatMetricValue` to handle the new case.
 */
export type MetricUnit = "count" | "byte" | "duration" | "ratio" | "timestamp";

/**
 * Format a numeric metric value according to its declared unit.
 *
 * Returns a human-readable string with appropriate suffix/prefix:
 * - `"byte"`:      binary prefixes (B, KB, MB, GB)
 * - `"duration"`:  time suffixes   (s, ms, µs)
 * - `"count"`:     SI-ish suffixes (k, M) or bare integer
 * - `"ratio"`:     percentage      (e.g. "95.0%")
 * - `"timestamp"`: raw number as-is
 */
export function formatMetricValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "byte":
      return formatBytes(value);
    case "duration":
      return formatDuration(value);
    case "count":
      return formatCount(value);
    case "ratio":
      return formatRatio(value);
    case "timestamp":
      return String(value);
  }
}

// --- internal helpers ---

function formatBytes(bytes: number): string {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  const KB = 1024;

  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

/** Matches the existing MetricNode.tsx duration formatting convention. */
function formatDuration(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(2)}s`;
  const ms = seconds * 1000;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  return `${(ms * 1000).toFixed(1)}µs`;
}

function formatCount(value: number): string {
  const M = 1_000_000;
  const K = 1_000;

  if (value >= M) return `${(value / M).toFixed(1)}M`;
  if (value >= K) return `${(value / K).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
