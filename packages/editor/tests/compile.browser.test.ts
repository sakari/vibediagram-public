import { describe, it, expect, afterEach } from "vitest";
import { createTestEditor } from "./helpers.js";

describe("compilation in browser", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  it("compiles TypeScript to JavaScript", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/main.ts":
          "const greeting: string = 'hello';\nconsole.log(greeting);\n",
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const result = await client.compile("/src/main.ts");
    expect(result.files.length).toBeGreaterThan(0);
    const jsFile = result.files[0];
    expect(jsFile.content).toContain("console.log");
    expect(jsFile.content).not.toContain(": string");
  });

  it("compilation with imports produces valid output", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/math.ts":
          "export function add(a: number, b: number): number { return a + b; }\n",
        "/src/main.ts":
          'import { add } from "./math";\nconsole.log(add(1, 2));\n',
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const result = await client.compile("/src/main.ts");
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBe(0);
  });

  it("compilation with type errors still emits JS", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/main.ts": "const x: number = 'hello';\nconsole.log(x);\n",
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    const result = await client.compile("/src/main.ts");
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe("error");
  });
});
