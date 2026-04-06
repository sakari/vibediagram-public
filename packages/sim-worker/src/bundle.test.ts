/**
 * Tests for the bundle module — verifies that Rollup-based in-memory bundling
 * produces correct IIFE output for various import patterns and that the
 * @diagram/sim-model shim wires up globals correctly.
 */
import { describe, expect, it } from "vitest";
import { bundle } from "./bundle";

/** Helper: evaluate an IIFE and return the value stored on globalThis.__testResult. */
function evalIife(
  code: string,
  simModelGlobals?: Record<string, unknown>,
): unknown {
  // When sim-model globals are needed, the IIFE references __simModelGlobals
  // which we inject as a function parameter — mirroring sim-worker's approach.
  if (simModelGlobals) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- testing bundled IIFE evaluation
    const fn = new Function("__simModelGlobals", code);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- testing bundled IIFE evaluation
    fn(simModelGlobals);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- testing bundled IIFE evaluation
    const fn = new Function(code);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- testing bundled IIFE evaluation
    fn();
  }
  const result = (globalThis as Record<string, unknown>).__testResult;
  delete (globalThis as Record<string, unknown>).__testResult;
  return result;
}

describe("bundle", () => {
  it("bundles named imports between two files", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import { add } from "./lib";\nglobalThis.__testResult = add(1, 2);',
        "/lib.js": "export function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(3);
  });

  it("handles aliased imports", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import { add as sum } from "./lib";\nglobalThis.__testResult = sum(10, 20);',
        "/lib.js": "export function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(30);
  });

  it("handles namespace imports", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import * as Lib from "./lib";\nglobalThis.__testResult = Lib.add(3, 4);',
        "/lib.js": "export function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(7);
  });

  it("handles default imports", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import add from "./lib";\nglobalThis.__testResult = add(5, 6);',
        "/lib.js": "export default function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(11);
  });

  it("resolves @diagram/sim-model to shim with injected globals", async () => {
    const simModelGlobals = {
      Blueprint: class Blueprint {
        name = "test";
      },
      createModel: () => ({ nodes: [] }),
    };

    const code = await bundle(
      {
        "/main.js": `
          import { Blueprint, createModel } from "@diagram/sim-model";
          const b = new Blueprint();
          const m = createModel();
          globalThis.__testResult = { name: b.name, nodes: m.nodes };
        `,
      },
      "/main.js",
    );

    const result = evalIife(code, simModelGlobals);
    expect(result).toEqual({ name: "test", nodes: [] });
  });

  it("handles nested directory imports", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import { add } from "./utils/math";\nglobalThis.__testResult = add(7, 8);',
        "/utils/math.js": "export function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(15);
  });

  it("handles parent-relative imports (../)", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import { add } from "./utils/math";\nglobalThis.__testResult = add(4, 5);',
        "/utils/math.js":
          'import { identity } from "../helpers";\nexport function add(a, b) { return identity(a + b); }',
        "/helpers.js": "export function identity(x) { return x; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(9);
  });

  it("handles re-exports", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import { add } from "./index";\nglobalThis.__testResult = add(9, 1);',
        "/index.js": 'export { add } from "./math";',
        "/math.js": "export function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(10);
  });

  it("produces IIFE output with no import/export statements", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import { add } from "./lib";\nexport const result = add(1, 2);',
        "/lib.js": "export function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    // IIFE format wraps everything — no bare ES module syntax should remain
    expect(code).not.toMatch(/^import\s/m);
    expect(code).not.toMatch(/^export\s/m);
  });

  it("resolves imports with .ts extension fallback", async () => {
    const code = await bundle(
      {
        "/main.js":
          'import { add } from "./lib";\nglobalThis.__testResult = add(2, 3);',
        "/lib.ts": "export function add(a, b) { return a + b; }",
      },
      "/main.js",
    );

    expect(evalIife(code)).toBe(5);
  });

  it("end-to-end: evaluates IIFE via new Function and returns correct results", async () => {
    const code = await bundle(
      {
        "/main.js": `
          import { multiply } from "./math";
          import { greet } from "./strings";
          globalThis.__testResult = { product: multiply(3, 7), greeting: greet("world") };
        `,
        "/math.js": "export function multiply(a, b) { return a * b; }",
        "/strings.js":
          'export function greet(name) { return "hello " + name; }',
      },
      "/main.js",
    );

    const result = evalIife(code);
    expect(result).toEqual({ product: 21, greeting: "hello world" });
  });
});
