import { describe, it, expect } from "vitest";
import { formatMetricValue } from "./unit";

describe("formatMetricValue", () => {
  describe("byte", () => {
    it("formats small values as bytes", () => {
      expect(formatMetricValue(0, "byte")).toBe("0 B");
      expect(formatMetricValue(512, "byte")).toBe("512 B");
      expect(formatMetricValue(1023, "byte")).toBe("1023 B");
    });

    it("formats kilobyte range with KB suffix", () => {
      expect(formatMetricValue(1024, "byte")).toBe("1.0 KB");
      expect(formatMetricValue(1536, "byte")).toBe("1.5 KB");
      expect(formatMetricValue(10240, "byte")).toBe("10.0 KB");
    });

    it("formats megabyte range with MB suffix", () => {
      expect(formatMetricValue(1048576, "byte")).toBe("1.0 MB");
      expect(formatMetricValue(1572864, "byte")).toBe("1.5 MB");
    });

    it("formats gigabyte range with GB suffix", () => {
      expect(formatMetricValue(1073741824, "byte")).toBe("1.0 GB");
      expect(formatMetricValue(2147483648, "byte")).toBe("2.0 GB");
    });
  });

  describe("duration", () => {
    it("formats seconds for values >= 1", () => {
      expect(formatMetricValue(1, "duration")).toBe("1.00s");
      expect(formatMetricValue(2.5, "duration")).toBe("2.50s");
      expect(formatMetricValue(100, "duration")).toBe("100.00s");
    });

    it("formats milliseconds for values >= 1ms", () => {
      expect(formatMetricValue(0.001, "duration")).toBe("1.0ms");
      expect(formatMetricValue(0.025, "duration")).toBe("25.0ms");
      expect(formatMetricValue(0.999, "duration")).toBe("999.0ms");
    });

    it("formats microseconds for values < 1ms", () => {
      expect(formatMetricValue(0.000025, "duration")).toBe("25.0µs");
      expect(formatMetricValue(0.000001, "duration")).toBe("1.0µs");
    });

    it("formats zero duration", () => {
      expect(formatMetricValue(0, "duration")).toBe("0.0µs");
    });
  });

  describe("count", () => {
    it("formats small values as integers", () => {
      expect(formatMetricValue(0, "count")).toBe("0");
      expect(formatMetricValue(1, "count")).toBe("1");
      expect(formatMetricValue(500, "count")).toBe("500");
      expect(formatMetricValue(999, "count")).toBe("999");
    });

    it("formats thousands with k suffix", () => {
      expect(formatMetricValue(1000, "count")).toBe("1.0k");
      expect(formatMetricValue(5000, "count")).toBe("5.0k");
      expect(formatMetricValue(999999, "count")).toBe("1000.0k");
    });

    it("formats millions with M suffix", () => {
      expect(formatMetricValue(1000000, "count")).toBe("1.0M");
      expect(formatMetricValue(2500000, "count")).toBe("2.5M");
    });
  });

  describe("ratio", () => {
    it("formats as percentage", () => {
      expect(formatMetricValue(0, "ratio")).toBe("0.0%");
      expect(formatMetricValue(0.5, "ratio")).toBe("50.0%");
      expect(formatMetricValue(0.95, "ratio")).toBe("95.0%");
      expect(formatMetricValue(1, "ratio")).toBe("100.0%");
    });

    it("handles ratios above 1", () => {
      expect(formatMetricValue(1.5, "ratio")).toBe("150.0%");
    });
  });

  describe("timestamp", () => {
    it("returns the raw number as a string", () => {
      expect(formatMetricValue(0, "timestamp")).toBe("0");
      expect(formatMetricValue(1234, "timestamp")).toBe("1234");
      expect(formatMetricValue(1.5, "timestamp")).toBe("1.5");
    });
  });
});
