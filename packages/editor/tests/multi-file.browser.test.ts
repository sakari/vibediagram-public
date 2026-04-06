import { describe, it, expect, afterEach } from "vitest";
import { createTestEditor } from "./helpers.js";

describe("multi-file imports in browser", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  it("valid import has no diagnostics", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/math.ts":
          "export function add(a: number, b: number): number { return a + b; }\n",
        "/src/main.ts": 'import { add } from "./math";\nconst x = add(1, 2);\n',
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const diagnostics = await client.getDiagnostics("/src/main.ts");
    expect(diagnostics.length).toBe(0);
  });

  it("missing import produces diagnostic", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/main.ts": 'import { nonExistent } from "./math";\n',
        "/src/math.ts":
          "export function add(a: number, b: number): number { return a + b; }\n",
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const diagnostics = await client.getDiagnostics("/src/main.ts");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("nonExistent"))).toBe(
      true,
    );
  });

  it("deleting imported file causes diagnostic", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/math.ts":
          "export function add(a: number, b: number): number { return a + b; }\n",
        "/src/main.ts": 'import { add } from "./math";\nconst x = add(1, 2);\n',
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const before = await client.getDiagnostics("/src/main.ts");
    expect(before.length).toBe(0);

    await client.deleteFile("/src/math.ts");

    const after = await client.getDiagnostics("/src/main.ts");
    expect(after.length).toBeGreaterThan(0);
  });
});
