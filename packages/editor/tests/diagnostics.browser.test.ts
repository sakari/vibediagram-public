import { describe, it, expect, afterEach } from "vitest";
import { createTestEditor } from "./helpers.js";

describe("diagnostics in browser", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  it("shows type error diagnostics", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/main.ts": "const x: number = 'hello';\n",
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const diagnostics = await client.getDiagnostics("/src/main.ts");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("not assignable");
  });

  it("clean code has no diagnostics", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/main.ts": "const x: number = 42;\n",
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const diagnostics = await client.getDiagnostics("/src/main.ts");
    expect(diagnostics.length).toBe(0);
  });
});
