import { describe, expect, it, beforeAll } from "vitest";
import type { Plugin } from "vite";
import { simModelDtsPlugin } from "./vite-plugin-sim-model-dts.js";

describe("simModelDtsPlugin", () => {
  let plugin: Plugin;

  beforeAll(() => {
    plugin = simModelDtsPlugin();
  });

  it("has name sim-model-dts", () => {
    expect(plugin.name).toBe("sim-model-dts");
  });

  describe("resolveId", () => {
    it("resolves virtual:sim-model-dts to the internal id", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const resolveId = plugin.resolveId as (id: string) => string | undefined;
      const result = resolveId("virtual:sim-model-dts");
      expect(result).toBe("\0virtual:sim-model-dts");
    });

    it("returns undefined for other ids", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const resolveId = plugin.resolveId as (id: string) => string | undefined;
      expect(resolveId("something-else")).toBeUndefined();
    });
  });

  describe("load", () => {
    // Cache the load result — tsc is slow, only run once
    let loadResult: string;
    let entries: { path: string; content: string }[];

    beforeAll(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const load = plugin.load as (id: string) => string | undefined;
      loadResult = load("\0virtual:sim-model-dts")!;

      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-type-assertion -- test: evaluating generated module code
      entries = new Function(
        loadResult.replace("export default ", "return "),
      )() as { path: string; content: string }[];
    }, 30000);

    it("returns undefined for non-matching id", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const load = plugin.load as (id: string) => string | undefined;
      expect(load("other-id")).toBeUndefined();
    });

    it("returns a module exporting an array with package.json and .d.ts entries", () => {
      expect(loadResult).toBeDefined();
      expect(loadResult).toContain("export default ");

      // First entry is always package.json, followed by one or more .d.ts files
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries[0]).toEqual(
        expect.objectContaining({
          path: "/node_modules/@diagram/sim-model/package.json",
        }),
      );

      const dtsEntries = entries.filter((e) => e.path.endsWith(".d.ts"));
      expect(dtsEntries.length).toBeGreaterThanOrEqual(1);

      // All .d.ts entries should be under the sim-model node_modules path
      for (const entry of dtsEntries) {
        expect(entry.path).toMatch(
          /^\/node_modules\/@diagram\/sim-model\/.+\.d\.ts$/,
        );
      }

      // Must include a top-level index.d.ts
      expect(dtsEntries.some((e) => e.path.endsWith("/index.d.ts"))).toBe(true);
    });

    it("includes package.json with correct content", () => {
      const pkgEntry = entries.find((e) => e.path.endsWith("package.json"))!;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: parsing known JSON shape
      const parsed = JSON.parse(pkgEntry.content) as {
        name: string;
        types: string;
      };
      expect(parsed).toEqual({
        name: "@diagram/sim-model",
        types: "index.d.ts",
      });
    });

    it("generated declarations include key exports across all .d.ts files", () => {
      const allContent = entries
        .filter((e) => e.path.endsWith(".d.ts"))
        .map((e) => e.content)
        .join("\n");

      expect(allContent).toContain("Blueprint");
      expect(allContent).toContain("Node");
      expect(allContent).toContain("Counter");
      expect(allContent).toContain("createModel");
    });
  });
});
