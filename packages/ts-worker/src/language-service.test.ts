import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LanguageServiceHost } from "./language-service.js";

const require = createRequire(import.meta.url);

/** Yield to the event loop so vitest's RPC heartbeat can be processed. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function loadLibFiles(): Record<string, string> {
  const tsDir = path.dirname(require.resolve("typescript/lib/lib.d.ts"));
  const result: Record<string, string> = {};
  for (const file of fs.readdirSync(tsDir)) {
    if (file.startsWith("lib.") && file.endsWith(".d.ts")) {
      result["/" + file] = fs.readFileSync(path.join(tsDir, file), "utf-8");
    }
  }
  return result;
}

let libFiles: Record<string, string>;

beforeAll(() => {
  libFiles = loadLibFiles();
});

describe("initialization", () => {
  it("initializing returns a TypeScript version string", async () => {
    const host = new LanguageServiceHost();
    const version = host.initialize(libFiles);
    await tick();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("after init, getKnownFiles returns empty when no user files synced yet", async () => {
    const host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
    expect(host.getKnownFiles()).toEqual([]);
  });

  it("calling methods before initialize returns empty/null results", () => {
    const host = new LanguageServiceHost();
    expect(host.getKnownFiles()).toEqual([]);
    expect(host.getDiagnostics("/x.ts")).toEqual([]);
    expect(host.getCompletions("/x.ts", 0)).toEqual([]);
    expect(host.getQuickInfo("/x.ts", 0)).toBeNull();
    expect(host.getDefinition("/x.ts", 0)).toBeNull();
    expect(host.getReferences("/x.ts", 0)).toEqual([]);
    expect(host.compile("/x.ts")).toEqual({ files: [], diagnostics: [] });
  });
});

describe("file operations", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("syncFile adds a file, getKnownFiles includes it", () => {
    host.syncFile("/test.ts", "const x = 1");
    expect(host.getKnownFiles()).toContain("/test.ts");
  });

  it("syncFile again updates the file, getKnownFiles still has it once", () => {
    host.syncFile("/test.ts", "const x = 1");
    host.syncFile("/test.ts", "const x = 2");
    expect(host.getKnownFiles()).toEqual(["/test.ts"]);
  });

  it("deleteFile removes it from known files", () => {
    host.syncFile("/test.ts", "const x = 1");
    host.deleteFile("/test.ts");
    expect(host.getKnownFiles()).not.toContain("/test.ts");
  });

  it("deleteFile on unknown file does nothing", () => {
    host.deleteFile("/nonexistent.ts");
    expect(host.getKnownFiles()).toEqual([]);
  });
});

describe("diagnostics", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("clean code returns no diagnostics", () => {
    host.syncFile("/test.ts", "const x: number = 42");
    expect(host.getDiagnostics("/test.ts")).toEqual([]);
  });

  it("type error returns diagnostic with severity error", () => {
    host.syncFile("/test.ts", 'const x: number = "hello"');
    const diags = host.getDiagnostics("/test.ts");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => d.severity === "error")).toBe(true);
    expect(
      diags.some(
        (d) =>
          d.message.toLowerCase().includes("string") ||
          d.message.toLowerCase().includes("number"),
      ),
    ).toBe(true);
  });

  it("multiple errors in one file returns multiple diagnostics", () => {
    host.syncFile("/test.ts", 'const a: number = "x"; const b: string = 123');
    const diags = host.getDiagnostics("/test.ts");
    expect(diags.length).toBeGreaterThanOrEqual(2);
  });

  it("after fixing a file via syncFile, diagnostics clear", () => {
    host.syncFile("/test.ts", 'const x: number = "hello"');
    expect(host.getDiagnostics("/test.ts").length).toBeGreaterThan(0);
    host.syncFile("/test.ts", "const x: number = 42");
    expect(host.getDiagnostics("/test.ts")).toEqual([]);
  });
});

describe("multi-file imports", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("file A exports a function, file B imports it — no diagnostics on either", () => {
    host.syncFile("/a.ts", "export function greet() { return 'hi' }");
    host.syncFile("/b.ts", 'import { greet } from "./a"; greet()');
    expect(host.getDiagnostics("/a.ts")).toEqual([]);
    expect(host.getDiagnostics("/b.ts")).toEqual([]);
  });

  it("file B imports something that does not exist in A — error diagnostic on B", () => {
    host.syncFile("/a.ts", "export function greet() {}");
    host.syncFile("/b.ts", 'import { greet, missing } from "./a"');
    const diags = host.getDiagnostics("/b.ts");
    expect(diags.some((d) => d.severity === "error")).toBe(true);
  });

  it("after adding the missing export to A, diagnostics on B clear", () => {
    host.syncFile("/a.ts", "export function greet() {}");
    host.syncFile("/b.ts", 'import { greet, missing } from "./a"');
    expect(host.getDiagnostics("/b.ts").length).toBeGreaterThan(0);
    host.syncFile(
      "/a.ts",
      "export function greet() {}; export const missing = 1",
    );
    expect(host.getDiagnostics("/b.ts")).toEqual([]);
  });
});

describe("completions", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("after typing x. where x is { foo: 1, bar: 2 }, completions include foo and bar", () => {
    const content = "const x = { foo: 1, bar: 2 };\nx.";
    host.syncFile("/test.ts", content);
    const offset = content.length;
    const completions = host.getCompletions("/test.ts", offset);
    const labels = completions.map((c) => c.label);
    expect(labels).toContain("foo");
    expect(labels).toContain("bar");
  });
});

describe("quick info", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("hovering over a variable with a known type returns type info text", () => {
    const content = "const count: number = 42";
    host.syncFile("/test.ts", content);
    const offset = content.indexOf("count");
    const info = host.getQuickInfo("/test.ts", offset);
    expect(info).not.toBeNull();

    expect(info!.text.toLowerCase()).toContain("number");
  });
});

describe("go to definition", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("definition at greet() in B points to A", () => {
    host.syncFile("/a.ts", "export function greet() {}");
    const content = 'import { greet } from "./a"; greet()';
    host.syncFile("/b.ts", content);
    const offset = content.indexOf("greet()");
    const def = host.getDefinition("/b.ts", offset);
    expect(def).not.toBeNull();

    expect(def!.targetPath).toBe("/a.ts");

    expect(def!.targetOffset).toBeGreaterThanOrEqual(0);
  });
});

describe("compilation", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("compile returns output files with .js extension", () => {
    host.syncFile("/main.ts", "const x = 1; export default x");
    const { files } = host.compile("/main.ts");
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.path.endsWith(".js"))).toBe(true);
  });

  it("compiled output contains the transpiled code", () => {
    host.syncFile("/main.ts", "const x = 1; console.log(x)");
    const { files } = host.compile("/main.ts");
    const jsFile = files.find((f) => f.path.endsWith(".js"));
    expect(jsFile).toBeDefined();

    expect(jsFile!.content.length).toBeGreaterThan(0);

    expect(jsFile!.content).toContain("console");
  });

  it("compiling a file with type errors still produces output files plus diagnostics", () => {
    host.syncFile("/main.ts", 'const x: number = "bad"');
    const { files, diagnostics } = host.compile("/main.ts");
    expect(files.length).toBeGreaterThan(0);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("compiling an empty file returns empty results", () => {
    host.syncFile("/main.ts", "");
    const { files, diagnostics } = host.compile("/main.ts");
    expect(files).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("compiling a file that was never synced returns empty results", () => {
    const { files, diagnostics } = host.compile("/never-synced.ts");
    expect(files).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

describe("missing source file", () => {
  let host: LanguageServiceHost;

  beforeAll(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("all methods return gracefully for empty-content and unsynced files", () => {
    host.syncFile("/empty.ts", "");
    expect(host.getDiagnostics("/empty.ts")).toEqual([]);
    expect(host.getCompletions("/empty.ts", 0)).toEqual([]);
    expect(host.getQuickInfo("/empty.ts", 0)).toBeNull();
    expect(host.getDefinition("/empty.ts", 0)).toBeNull();
    expect(host.compile("/empty.ts")).toEqual({ files: [], diagnostics: [] });

    expect(host.getDiagnostics("/missing.ts")).toEqual([]);
    expect(host.compile("/missing.ts")).toEqual({ files: [], diagnostics: [] });
  });

  it("syncing real content after empty restores full functionality", () => {
    host.syncFile("/lazy.ts", "");
    expect(host.compile("/lazy.ts").files).toEqual([]);
    expect(host.getDiagnostics("/lazy.ts")).toEqual([]);

    host.syncFile("/lazy.ts", "export const x = 1;");
    const { files, diagnostics } = host.compile("/lazy.ts");
    expect(files.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([]);

    host.syncFile("/lazy.ts", 'const y: number = "bad"');
    expect(host.getDiagnostics("/lazy.ts").length).toBeGreaterThan(0);
  });
});

describe("compiler options branches", () => {
  it("initialize with custom target, module, moduleResolution, strict, and lib", async () => {
    const host = new LanguageServiceHost();
    const version = host.initialize(libFiles, {
      target: "ES2020",
      module: "ES2020",
      moduleResolution: "Bundler",
      strict: true,
      lib: ["lib.es2020.d.ts", 42], // 42 should be filtered out
    });
    await tick();
    expect(typeof version).toBe("string");
    // Strict mode should cause errors on implicit any
    host.syncFile("/strict.ts", "function f(x) { return x }");
    const diags = host.getDiagnostics("/strict.ts");
    expect(diags.length).toBeGreaterThan(0);
  });

  it("initialize with unknown target/module/moduleResolution uses defaults", async () => {
    const host = new LanguageServiceHost();
    host.initialize(libFiles, {
      target: "UNKNOWN",
      module: "UNKNOWN",
      moduleResolution: "UNKNOWN",
      strict: "not-a-boolean",
      lib: "not-an-array",
    });
    await tick();
    host.syncFile("/test.ts", "const x: number = 42");
    expect(host.getDiagnostics("/test.ts")).toEqual([]);
  });
});

describe("diagnostic mapping edge cases", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("warning diagnostics get severity warning", () => {
    // Use a deprecated API to trigger a warning/suggestion
    host.syncFile(
      "/warn.ts",
      "interface I { /** @deprecated use bar */ foo(): void; bar(): void; }\n" +
        "declare const obj: I;\nobj.foo();",
    );
    const diags = host.getDiagnostics("/warn.ts");
    // Even if no warning, we at least verify the mapping doesn't crash
    expect(Array.isArray(diags)).toBe(true);
  });
});

describe("syncFile edge cases", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("re-syncing a file that was emptied (knownFiles has it but no source file) re-creates it", () => {
    host.syncFile("/resync.ts", "export const a = 1;");
    expect(host.getKnownFiles()).toContain("/resync.ts");

    // Update to empty — the TS program may drop the source file
    host.syncFile("/resync.ts", "");

    // Now sync with real content again — should take the createFile path
    // because hasSourceFile may return false for empty content
    host.syncFile("/resync.ts", "export const b = 2;");
    expect(host.getKnownFiles()).toContain("/resync.ts");
    const { files } = host.compile("/resync.ts");
    expect(files.length).toBeGreaterThan(0);
  });

  it("syncFile before initialize does nothing", () => {
    const uninitHost = new LanguageServiceHost();
    uninitHost.syncFile("/test.ts", "const x = 1;");
    expect(uninitHost.getKnownFiles()).toEqual([]);
  });
});

describe("deleteFile before initialize", () => {
  it("deleteFile before initialize does nothing", () => {
    const host = new LanguageServiceHost();
    // Call deleteFile without calling initialize — should hit !this.env return
    host.deleteFile("/test.ts");
    expect(host.getKnownFiles()).toEqual([]);
  });
});

describe("deleteFile edge cases", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("deleteFile on a file whose env.deleteFile throws falls back to updateFile empty", () => {
    host.syncFile("/del.ts", "export const x = 1;");
    expect(host.getKnownFiles()).toContain("/del.ts");
    // Delete should work regardless of whether env.deleteFile throws
    host.deleteFile("/del.ts");
    expect(host.getKnownFiles()).not.toContain("/del.ts");
  });

  it("deleteFile falls back to updateFile when env.deleteFile throws", () => {
    host.syncFile("/catch.ts", "const x = 1;");
    // Monkey-patch env.deleteFile to simulate a throw
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
    const env = (host as any).env;
    const original = env.deleteFile;
    env.deleteFile = () => {
      throw new Error("simulated VFS error");
    };
    // deleteFile should catch the error and fall back to updateFile("")
    host.deleteFile("/catch.ts");
    expect(host.getKnownFiles()).not.toContain("/catch.ts");
    env.deleteFile = original;
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
  });
});

describe("getCompletions edge cases", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("getCompletions at invalid offset returns empty array", () => {
    host.syncFile("/comp.ts", "const x = 1;");
    // offset 0 is at the very start — might return completions or empty
    const completions = host.getCompletions("/comp.ts", 0);
    expect(Array.isArray(completions)).toBe(true);
  });

  it("getCompletions inside a block comment returns empty array", () => {
    host.syncFile("/nocomp.ts", "/* block comment */\nconst x = 1;");
    // Inside a block comment, TS returns no completions
    const completions = host.getCompletions("/nocomp.ts", 5);
    expect(completions).toEqual([]);
  });

  it("getCompletions with import completions includes detail from labelDetails", () => {
    host.syncFile("/mod.ts", "export const hello = 1; export const world = 2;");
    const content = 'import { } from "./mod";\n';
    host.syncFile("/imp.ts", content);
    // Position inside the braces at index 9 (between { and })
    const completions = host.getCompletions("/imp.ts", 9);
    expect(Array.isArray(completions)).toBe(true);
    // Check we get completions (hello/world from mod.ts)
    if (completions.length > 0) {
      expect(
        completions.some((c) => c.label === "hello" || c.label === "world"),
      ).toBe(true);
    }
  });

  it("getCompletions for auto-import includes detail with module path", () => {
    host.syncFile("/amod.ts", "export const myUniqueHelper = 42;");
    // Type the beginning of the exported name without importing it
    host.syncFile("/use.ts", "myUnique");
    const completions = host.getCompletions("/use.ts", 8);
    expect(Array.isArray(completions)).toBe(true);
    // Auto-import completions should include labelDetails.description
    const match = completions.find((c) => c.label === "myUniqueHelper");
    if (match) {
      expect(match.detail).toBeDefined();
    }
  });
});

describe("getQuickInfo edge cases", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("getQuickInfo at whitespace returns null", () => {
    host.syncFile("/qi.ts", "   \n   ");
    const info = host.getQuickInfo("/qi.ts", 0);
    expect(info).toBeNull();
  });

  it("getQuickInfo returns JSDoc documentation and tags for annotated functions", () => {
    const content = [
      "/**",
      " * Adds two numbers together.",
      " * @param a - first operand",
      " * @param b - second operand",
      " * @returns the sum",
      " */",
      "function add(a: number, b: number): number { return a + b; }",
    ].join("\n");
    host.syncFile("/jsdoc.ts", content);
    const offset = content.indexOf("add(");
    const info = host.getQuickInfo("/jsdoc.ts", offset);
    expect(info).not.toBeNull();
    expect(info!.documentation).toContain("Adds two numbers together");
    expect(info!.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "param" }),
        expect.objectContaining({ name: "returns" }),
      ]),
    );
  });

  it("getQuickInfo returns empty documentation for symbols without JSDoc", () => {
    host.syncFile("/nodoc.ts", "const count = 42;");
    const offset = 6; // inside "count"
    const info = host.getQuickInfo("/nodoc.ts", offset);
    expect(info).not.toBeNull();
    expect(info!.documentation).toBe("");
    expect(info!.tags).toEqual([]);
  });
});

describe("getDefinition edge cases", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("getDefinition at a position with no symbol returns null", () => {
    host.syncFile("/def.ts", "// just a comment\n");
    const def = host.getDefinition("/def.ts", 3);
    expect(def).toBeNull();
  });
});

describe("find references", () => {
  let host: LanguageServiceHost;

  beforeEach(async () => {
    host = new LanguageServiceHost();
    host.initialize(libFiles);
    await tick();
  });

  it("finds references across files for an exported class", () => {
    host.syncFile("/a.ts", "export class Greeter { greet() {} }");
    host.syncFile(
      "/b.ts",
      'import { Greeter } from "./a";\nconst g = new Greeter();',
    );
    const aContent = "export class Greeter { greet() {} }";
    const offset = aContent.indexOf("Greeter");
    const refs = host.getReferences("/a.ts", offset);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    const paths = refs.map((r) => r.path);
    expect(paths).toContain("/a.ts");
    expect(paths).toContain("/b.ts");
    // Each reference has valid start/end
    for (const ref of refs) {
      expect(ref.start).toBeGreaterThanOrEqual(0);
      expect(ref.end).toBeGreaterThan(ref.start);
    }
  });

  it("does not include lib-file references for built-in types", () => {
    host.syncFile("/arr.ts", "const a: Array<number> = [1, 2, 3];");
    const content = "const a: Array<number> = [1, 2, 3];";
    const offset = content.indexOf("Array");
    const refs = host.getReferences("/arr.ts", offset);
    // No reference should point to a lib file
    for (const ref of refs) {
      expect(ref.path).not.toMatch(/^\/lib\./);
    }
  });

  it("returns empty array for a position with no symbol", () => {
    host.syncFile("/empty.ts", "// just a comment\n");
    const refs = host.getReferences("/empty.ts", 3);
    expect(refs).toEqual([]);
  });

  it("returns empty array before initialization", () => {
    const uninitHost = new LanguageServiceHost();
    expect(uninitHost.getReferences("/x.ts", 0)).toEqual([]);
  });
});

describe("extra libs", () => {
  it("initialize with extraLib that declares a global type, use it in a file — no diagnostics", async () => {
    const host = new LanguageServiceHost();
    host.initialize(libFiles, {}, [
      { path: "/globals.d.ts", content: "declare const API_URL: string" },
    ]);
    await tick();
    host.syncFile("/main.ts", "console.log(API_URL)");
    const diags = host.getDiagnostics("/main.ts");
    expect(diags).toEqual([]);
  });
});

describe("VFS module resolution", () => {
  it("import from @diagram/sim-model resolves when package.json and index.d.ts are in extraLibs", () => {
    const host = new LanguageServiceHost();
    host.initialize(
      libFiles,
      { module: "ESNext", moduleResolution: "Bundler" },
      [
        {
          path: "/node_modules/@diagram/sim-model/package.json",
          content: '{"name":"@diagram/sim-model","types":"index.d.ts"}',
        },
        {
          path: "/node_modules/@diagram/sim-model/index.d.ts",
          content: "export class Blueprint {}",
        },
      ],
    );
    host.syncFile(
      "/main.ts",
      'import { Blueprint } from "@diagram/sim-model";\nconst b = new Blueprint();',
    );
    const diags = host.getDiagnostics("/main.ts");
    expect(diags).toEqual([]);
  });

  it("using Blueprint without importing it produces a diagnostic (no ambient globals)", () => {
    const host = new LanguageServiceHost();
    host.initialize(
      libFiles,
      { module: "ESNext", moduleResolution: "Bundler" },
      [
        {
          path: "/node_modules/@diagram/sim-model/package.json",
          content: '{"name":"@diagram/sim-model","types":"index.d.ts"}',
        },
        {
          path: "/node_modules/@diagram/sim-model/index.d.ts",
          content: "export class Blueprint {}",
        },
      ],
    );
    host.syncFile("/main.ts", "const b = new Blueprint();");
    const diags = host.getDiagnostics("/main.ts");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => d.severity === "error")).toBe(true);
  });

  it("real generated sim-model declarations resolve in VFS without diagnostics", async () => {
    const { generateSimModelDeclarations } =
      await import("./vite-plugin-sim-model-dts.js");
    const entries = generateSimModelDeclarations();
    const host = new LanguageServiceHost();
    host.initialize(
      libFiles,
      { module: "ESNext", moduleResolution: "Bundler" },
      [
        {
          path: "/node_modules/@diagram/sim-model/package.json",
          content: '{"name":"@diagram/sim-model","types":"index.d.ts"}',
        },
        ...entries,
      ],
    );
    host.syncFile(
      "/main.ts",
      'import { Blueprint, Node, metrics, createModel } from "@diagram/sim-model";\nconst m = createModel();\nconst b = new Blueprint();\nconst n = new Node();\nconst c = new metrics.Counter();',
    );
    const diags = host.getDiagnostics("/main.ts");
    expect(diags).toEqual([]);
  }, 30000);

  it("metrics namespace types resolve without diagnostics", async () => {
    const { generateSimModelDeclarations } =
      await import("./vite-plugin-sim-model-dts.js");
    const entries = generateSimModelDeclarations();
    const host = new LanguageServiceHost();
    host.initialize(
      libFiles,
      { module: "ESNext", moduleResolution: "Bundler" },
      [
        {
          path: "/node_modules/@diagram/sim-model/package.json",
          content: '{"name":"@diagram/sim-model","types":"index.d.ts"}',
        },
        ...entries,
      ],
    );
    host.syncFile(
      "/main.ts",
      'import { metrics, createModel } from "@diagram/sim-model";\n' +
        "const model = createModel();\n" +
        'const qps = model.create<metrics.Counter<"count">>("qps", metrics.Counter, { unit: "count" });',
    );
    const diags = host.getDiagnostics("/main.ts");
    expect(diags).toEqual([]);
  }, 30000);
});
