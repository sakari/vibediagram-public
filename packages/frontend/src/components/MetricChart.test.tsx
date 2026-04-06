import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MetricTimeSeries } from "../hooks/useMetricHistory";
import MetricChart from "./MetricChart";

function makeSeries(
  overrides: Partial<MetricTimeSeries> = {},
): MetricTimeSeries {
  return {
    label: "requests",
    points: [
      { simTime: 0, value: 1 },
      { simTime: 1, value: 3 },
      { simTime: 2, value: 2 },
    ],
    unit: "count",
    metricType: "counter",
    ...overrides,
  };
}

describe("MetricChart", () => {
  it("renders an SVG with a path element for a single series", () => {
    const { container } = render(<MetricChart series={[makeSeries()]} />);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();

    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(1);
  });

  it("renders multiple paths for multiple series", () => {
    const series = [
      makeSeries({ label: "a" }),
      makeSeries({ label: "b", metricType: "gauge" }),
    ];
    const { container } = render(<MetricChart series={series} />);

    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(2);
  });

  it("renders a legend when multiple series are present", () => {
    const series = [
      makeSeries({ label: "alpha" }),
      makeSeries({ label: "beta" }),
    ];
    const { container } = render(<MetricChart series={series} />);

    // Legend uses <text> elements with the series labels.
    const texts = Array.from(container.querySelectorAll("text"));
    const legendLabels = texts.map((t) => t.textContent);
    expect(legendLabels).toEqual(expect.arrayContaining(["alpha", "beta"]));
  });

  it("renders axis labels for a single series (no legend)", () => {
    const { container } = render(<MetricChart series={[makeSeries()]} />);

    const texts = Array.from(container.querySelectorAll("text"));
    // Should have x-axis tick labels and y-axis tick labels but no legend.
    expect(texts.length).toBeGreaterThan(0);
    // Should not contain series label text (legend absent).
    const legendTexts = texts.filter((t) => t.textContent === "requests");
    expect(legendTexts.length).toBe(0);
  });

  it("renders nothing when series array is empty", () => {
    const { container } = render(<MetricChart series={[]} />);

    const svg = container.querySelector("svg");
    expect(svg).toBeNull();
  });

  it("renders nothing when all series have empty points", () => {
    const { container } = render(
      <MetricChart series={[makeSeries({ points: [] })]} />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeNull();
  });

  it("renders placeholder SVG when placeholder is true", () => {
    const { container } = render(
      <MetricChart
        series={[]}
        placeholder
        placeholderLabels={[{ label: "throughput", unit: "count" }]}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("metric chart");

    // Should have axis tick labels (y-axis and x-axis)
    const texts = Array.from(container.querySelectorAll("text"));
    expect(texts.length).toBeGreaterThanOrEqual(6); // 3 y-axis + 3 x-axis

    // X-axis should include time labels
    const textContents = texts.map((t) => t.textContent);
    expect(textContents).toEqual(expect.arrayContaining(["0ms"]));

    // No data lines or circles
    expect(container.querySelectorAll("path").length).toBe(0);
    expect(container.querySelectorAll("circle").length).toBe(0);
  });

  it("renders placeholder without labels when placeholder is true and no placeholderLabels", () => {
    const { container } = render(<MetricChart series={[]} placeholder />);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();

    // Should have axis tick labels but no legend
    const texts = Array.from(container.querySelectorAll("text"));
    expect(texts.length).toBeGreaterThanOrEqual(6); // 3 y-axis + 3 x-axis
    expect(container.querySelectorAll("circle").length).toBe(0);
  });

  it("renders placeholder with legend when multiple placeholderLabels provided", () => {
    const { container } = render(
      <MetricChart
        series={[]}
        placeholder
        placeholderLabels={[
          { label: "alpha", unit: "count" },
          { label: "beta", unit: "count" },
        ]}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();

    // Legend labels should be present
    const texts = Array.from(container.querySelectorAll("text"));
    const textContents = texts.map((t) => t.textContent);
    expect(textContents).toEqual(expect.arrayContaining(["alpha", "beta"]));

    // Legend circles for color swatches
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(2);
  });

  it("renders a circle for a single-point series", () => {
    const series = [makeSeries({ points: [{ simTime: 0, value: 5 }] })];
    const { container } = render(<MetricChart series={series} />);

    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(1);

    // No path for a single-point series.
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(0);
  });

  describe("timeWindow filtering", () => {
    const longSeries = makeSeries({
      points: [
        { simTime: 0, value: 1 },
        { simTime: 10, value: 2 },
        { simTime: 20, value: 3 },
        { simTime: 50, value: 4 },
        { simTime: 80, value: 5 },
        { simTime: 100, value: 6 },
      ],
    });

    it("shows all points when timeWindow is null", () => {
      const { container } = render(
        <MetricChart series={[longSeries]} timeWindow={null} />,
      );
      // Should render a path with all 6 points
      const paths = container.querySelectorAll("path");
      expect(paths.length).toBe(1);
      // X-axis should include 0ms label (formatTime(0) = "0ms")
      const texts = Array.from(container.querySelectorAll("text"));
      expect(texts.some((t) => t.textContent === "0ms")).toBe(true);
    });

    it("filters to last N seconds when timeWindow is set", () => {
      const { container } = render(
        <MetricChart series={[longSeries]} timeWindow={30} />,
      );
      // With window=30, cutoff=70, only points at t=80 and t=100 remain
      const texts = Array.from(container.querySelectorAll("text"));
      // Should not include 0ms label
      expect(texts.every((t) => t.textContent !== "0ms")).toBe(true);
    });

    it("filters out series with no points in the time window", () => {
      const { container } = render(
        <MetricChart
          series={[
            makeSeries({
              points: [{ simTime: 0, value: 1 }],
            }),
            makeSeries({
              label: "other",
              points: [{ simTime: 100, value: 2 }],
            }),
          ]}
          timeWindow={1}
        />,
      );
      // First series point at t=0 is outside window [99, 100], so only second series renders
      const paths = container.querySelectorAll("path");
      const circles = container.querySelectorAll("circle");
      // Second series has 1 point -> circle, first series filtered out
      expect(circles.length).toBeGreaterThanOrEqual(1);
      expect(paths.length).toBe(0);
    });

    it("shows all points when timeWindow exceeds total duration", () => {
      const { container } = render(
        <MetricChart series={[longSeries]} timeWindow={9999} />,
      );
      const paths = container.querySelectorAll("path");
      expect(paths.length).toBe(1);
    });
  });
});
