import { describe, it, expect } from "vitest";
import { generateHelpFiles } from "./help-content.js";

describe("generateHelpFiles", () => {
  const files = generateHelpFiles();

  it("returns expected file paths", () => {
    const paths = [...files.keys()].sort();
    expect(paths).toEqual([
      "/help/README.md",
      "/help/examples/cache.ts",
      "/help/examples/loadbalancer.ts",
      "/help/examples/worker-pool.ts",
      "/help/reference/api-reference.md",
      "/help/reference/builtin-blueprints.md",
      "/help/reference/comments.md",
      "/help/reference/distributions.md",
      "/help/reference/inputs.md",
      "/help/reference/metrics.md",
      "/help/reference/styling.md",
    ]);
  });

  it("all files have non-empty content", () => {
    for (const [path, content] of files) {
      expect(content.length, `${path} should have content`).toBeGreaterThan(0);
    }
  });

  it("modeling guide covers core concepts", () => {
    const guide = files.get("/help/README.md")!;
    expect(guide).toContain("createModel");
    expect(guide).toContain("Blueprint");
    expect(guide).toContain("component.ref");
    expect(guide).toContain("engineOnStart");
    expect(guide).toContain("model.create");
    expect(guide).toContain("Style rules");
  });

  it("api reference covers all major APIs", () => {
    const ref = files.get("/help/reference/api-reference.md")!;
    expect(ref).toContain("metrics.Counter");
    expect(ref).toContain("metrics.Gauge");
    expect(ref).toContain("metrics.Summary");
    expect(ref).toContain("InputNode");
    expect(ref).toContain("distributions.Exponential");
    expect(ref).toContain("blueprints.LatencyBlueprint");
    expect(ref).toContain("blueprints.ResourcePool");
  });

  it("examples are real sim-examples source with valid imports", () => {
    for (const [fusePath, content] of files) {
      if (!fusePath.endsWith(".ts")) continue;
      expect(content).toContain('from "@diagram/sim-model"');
      expect(content).toContain("export const model");
    }
  });
});

describe("help files integrate with FuseHandlers", () => {
  it("all paths start with /help/", () => {
    const files = generateHelpFiles();
    for (const path of files.keys()) {
      expect(path).toMatch(/^\/help\//);
    }
  });

  it("nested paths are valid for static dir resolution", () => {
    const files = generateHelpFiles();
    for (const path of files.keys()) {
      expect(path).not.toContain("\\");
      expect(path).toMatch(/^\/[^/]+(\/[^/]+)*$/);
    }
  });
});
