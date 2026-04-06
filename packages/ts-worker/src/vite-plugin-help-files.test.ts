import { describe, it, expect } from "vitest";
import { generateHelpEntries } from "./vite-plugin-help-files.js";

describe("generateHelpEntries", () => {
  const entries = generateHelpEntries();

  it("returns documentation and example entries", () => {
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toContain("/help/README.md");
    expect(paths).toContain("/help/reference/api-reference.md");
    expect(paths).toContain("/help/reference/metrics.md");
    expect(paths).toContain("/help/reference/inputs.md");
    expect(paths).toContain("/help/reference/distributions.md");
    expect(paths).toContain("/help/reference/builtin-blueprints.md");
    expect(paths).toContain("/help/reference/styling.md");
    expect(paths).toContain("/help/examples/cache.ts");
    expect(paths).toContain("/help/examples/loadbalancer.ts");
    expect(paths).toContain("/help/examples/worker-pool.ts");
  });

  it("all entries have non-empty content", () => {
    for (const entry of entries) {
      expect(
        entry.content.length,
        `${entry.path} should have content`,
      ).toBeGreaterThan(0);
    }
  });

  it("returns { path, content } shape compatible with extraLibs", () => {
    for (const entry of entries) {
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("content");
      expect(typeof entry.path).toBe("string");
      expect(typeof entry.content).toBe("string");
    }
  });
});
