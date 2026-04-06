import { describe, expect, it, beforeEach } from "vitest";
import type { Plugin } from "vite";
import { tsLibPlugin } from "./vite-plugin-ts-lib.js";

describe("tsLibPlugin", () => {
  let plugin: Plugin;

  beforeEach(() => {
    plugin = tsLibPlugin();
  });

  it("has name ts-lib-files", () => {
    expect(plugin.name).toBe("ts-lib-files");
  });

  describe("resolveId", () => {
    it("resolves virtual:ts-lib-files to the internal id", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const resolveId = plugin.resolveId as (id: string) => string | undefined;
      const result = resolveId("virtual:ts-lib-files");
      expect(result).toBe("\0virtual:ts-lib-files");
    });

    it("returns undefined for other ids", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const resolveId = plugin.resolveId as (id: string) => string | undefined;
      expect(resolveId("something-else")).toBeUndefined();
    });
  });

  describe("load", () => {
    it("returns undefined for non-matching id", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const load = plugin.load as (id: string) => string | undefined;
      expect(load("other-id")).toBeUndefined();
    });

    it("returns a module exporting a Map of lib files for the resolved id", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const load = plugin.load as (id: string) => string | undefined;
      const result = load("\0virtual:ts-lib-files");
      expect(result).toBeDefined();
      expect(result).toContain("export default new Map(");
      // Should contain at least the core lib.d.ts
      expect(result).toContain("/lib.d.ts");
      expect(result).toContain("/lib.es5.d.ts");
    });

    it("only includes lib.*.d.ts files", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const load = plugin.load as (id: string) => string | undefined;
      const result = load("\0virtual:ts-lib-files")!;
      // Every key in the map should start with "/lib." and end with ".d.ts"
      const keys = [...result.matchAll(/\["(\/[^"]+)"/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).toMatch(/^\/lib(\..+)?\.d\.ts$/);
      }
    });
  });

  describe("load output format", () => {
    it("generates valid JS that creates a Map", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test: Vite plugin hooks can be functions
      const load = plugin.load as (id: string) => string | undefined;
      const code = load("\0virtual:ts-lib-files")!;
      // The output should be valid JS that creates a Map
      expect(code).toMatch(/^export default new Map\(\[.*\]\);$/s);
    });
  });
});
