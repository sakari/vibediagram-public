import { describe, it, expect, afterEach } from "vitest";
import { createTestEditor } from "./helpers.js";

describe("ts-extensions in browser", () => {
  let cleanup: () => void = () => {};

  afterEach(() => {
    cleanup();
  });

  it("autocomplete returns completions after dot access", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/main.ts": 'const greeting = "hello";\ngreeting.',
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    // Position after "greeting." (end of the file)
    const offset = 'const greeting = "hello";\ngreeting.'.length;
    const completions = await client.getCompletions("/src/main.ts", offset);
    expect(completions.length).toBeGreaterThan(0);
  });

  it("go-to-def returns target for imported symbol", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/utils.ts": "export const helper = 42;\n",
        "/src/main.ts":
          'import { helper } from "./utils.js";\nconst x = helper;\n',
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    // Position at "helper" in "const x = helper"
    const offset = 'import { helper } from "./utils.js";\nconst x = '.length;
    const result = await client.getDefinition("/src/main.ts", offset);
    expect(result).not.toBeNull();
    expect(result!.targetPath).toBe("/src/utils.ts");
    expect(typeof result!.targetOffset).toBe("number");
  });

  it("hover returns quick info for typed variable", async () => {
    const { client, cleanup: c } = await createTestEditor(
      {
        "/src/main.ts": "const count: number = 42;\n",
      },
      { initialFile: "/src/main.ts" },
    );
    cleanup = c;

    // Position at "count"
    const offset = "const ".length;
    const info = await client.getQuickInfo("/src/main.ts", offset);
    expect(info).not.toBeNull();
    expect(info!.text).toBeTruthy();
    expect(typeof info!.text).toBe("string");
  });
});
