import ts from "typescript";
import {
  createSystem,
  createVirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import type { Diagnostic, Completion, Reference } from "./protocol.js";

const ROOT_FILE = "/__root__.ts";

/**
 * Converts a plain object with string values to ts.CompilerOptions.
 * Uses sensible defaults for target, module, and moduleResolution.
 */
function toCompilerOptions(
  opts: Record<string, unknown> = {},
): ts.CompilerOptions {
  const targetMap: Record<string, ts.ScriptTarget> = {
    ES5: ts.ScriptTarget.ES5,
    ES6: ts.ScriptTarget.ES2015,
    ES2015: ts.ScriptTarget.ES2015,
    ES2016: ts.ScriptTarget.ES2016,
    ES2017: ts.ScriptTarget.ES2017,
    ES2018: ts.ScriptTarget.ES2018,
    ES2019: ts.ScriptTarget.ES2019,
    ES2020: ts.ScriptTarget.ES2020,
    ES2021: ts.ScriptTarget.ES2021,
    ES2022: ts.ScriptTarget.ES2022,
    ES2023: ts.ScriptTarget.ES2023,
    ESNext: ts.ScriptTarget.ESNext,
  };
  const moduleMap: Record<string, ts.ModuleKind> = {
    None: ts.ModuleKind.None,
    CommonJS: ts.ModuleKind.CommonJS,
    AMD: ts.ModuleKind.AMD,
    UMD: ts.ModuleKind.UMD,
    System: ts.ModuleKind.System,
    ES2015: ts.ModuleKind.ES2015,
    ES2020: ts.ModuleKind.ES2020,
    ES2022: ts.ModuleKind.ES2022,
    ESNext: ts.ModuleKind.ESNext,
  };
  const moduleResolutionMap: Record<string, ts.ModuleResolutionKind> = {
    Classic: ts.ModuleResolutionKind.Classic,
    Node: ts.ModuleResolutionKind.Node10,
    Node10: ts.ModuleResolutionKind.Node10,
    Node16: ts.ModuleResolutionKind.Node16,
    NodeNext: ts.ModuleResolutionKind.NodeNext,
    Bundler: ts.ModuleResolutionKind.Bundler,
  };

  const result: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    noEmit: false,
    esModuleInterop: true,
  };

  if (typeof opts.target === "string" && opts.target in targetMap) {
    result.target = targetMap[opts.target];
  }
  if (typeof opts.module === "string" && opts.module in moduleMap) {
    result.module = moduleMap[opts.module];
  }
  if (
    typeof opts.moduleResolution === "string" &&
    opts.moduleResolution in moduleResolutionMap
  ) {
    result.moduleResolution = moduleResolutionMap[opts.moduleResolution];
  }
  if (typeof opts.strict === "boolean") {
    result.strict = opts.strict;
  }
  if (Array.isArray(opts.lib)) {
    result.lib = opts.lib.filter((x): x is string => typeof x === "string");
  }

  return result;
}

function mapDiagnostic(d: ts.Diagnostic): Diagnostic {
  const start = d.start ?? 0;
  const length = d.length ?? 0;
  let severity: Diagnostic["severity"] = "info";
  if (d.category === ts.DiagnosticCategory.Error) severity = "error";
  else if (d.category === ts.DiagnosticCategory.Warning) severity = "warning";
  return {
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    start,
    end: start + length,
    severity,
  };
}

/**
 * Host for TypeScript language service backed by @typescript/vfs.
 * Holds the VFS environment and exposes synchronous methods for diagnostics,
 * completions, quickinfo, definition, and compile.
 */
export class LanguageServiceHost {
  private env: ReturnType<typeof createVirtualTypeScriptEnvironment> | null =
    null;
  private knownFiles = new Set<string>();
  private tsVersion = "";

  /**
   * Creates the virtual environment. Must be called before any other methods.
   */
  initialize(
    libFiles: Record<string, string>,
    compilerOptions: Record<string, unknown> = {},
    extraLibs: { path: string; content: string }[] = [],
  ): string {
    const fsMap = new Map<string, string>();
    for (const [path, content] of Object.entries(libFiles)) {
      fsMap.set(path, content);
    }
    for (const { path: p, content } of extraLibs) {
      fsMap.set(p, content);
    }
    fsMap.set(ROOT_FILE, "// root");
    const system = createSystem(fsMap);
    const opts = toCompilerOptions(compilerOptions);
    const rootFiles = [ROOT_FILE, ...extraLibs.map(({ path: p }) => p)];
    this.env = createVirtualTypeScriptEnvironment(system, rootFiles, ts, opts);
    this.knownFiles.clear();
    this.tsVersion = ts.version;
    return this.tsVersion;
  }

  /**
   * Creates or updates a file. Uses createFile for new files, updateFile for existing.
   */
  syncFile(path: string, content: string): void {
    if (!this.env) return;
    if (this.knownFiles.has(path) && this.hasSourceFile(path)) {
      this.env.updateFile(path, content);
    } else {
      this.env.createFile(path, content);
      this.knownFiles.add(path);
    }
  }

  /**
   * Removes a file from the program. Uses deleteFile when available.
   */
  deleteFile(path: string): void {
    if (!this.env) return;
    if (this.knownFiles.has(path)) {
      try {
        this.env.deleteFile(path);
      } catch {
        this.env.updateFile(path, "");
      }
      this.knownFiles.delete(path);
    }
  }

  /**
   * Returns known source file paths. Used by the worker for debounced diagnostics push.
   */
  getKnownFiles(): string[] {
    return Array.from(this.knownFiles);
  }

  /** True when the file exists as a real source file in the TS program (empty files may not). */
  private hasSourceFile(path: string): boolean {
    const program = this.env?.languageService.getProgram();
    return !!program?.getSourceFile(path);
  }

  /**
   * Returns syntactic and semantic diagnostics for a file.
   */
  getDiagnostics(path: string): Diagnostic[] {
    if (!this.env || !this.hasSourceFile(path)) return [];
    const syntactic = this.env.languageService.getSyntacticDiagnostics(path);
    const semantic = this.env.languageService.getSemanticDiagnostics(path);
    return [...syntactic, ...semantic].map((d) => mapDiagnostic(d));
  }

  /**
   * Returns completions at the given offset.
   */
  getCompletions(path: string, offset: number): Completion[] {
    if (!this.env || !this.hasSourceFile(path)) return [];
    const info = this.env.languageService.getCompletionsAtPosition(
      path,
      offset,
      undefined,
    );
    if (!info?.entries) return [];
    return info.entries.map((entry) => ({
      label: entry.name,
      kind: entry.kind,
      detail: entry.labelDetails?.description,
      insertText: entry.insertText,
      sortText: entry.sortText,
    }));
  }

  /**
   * Returns quick info (hover) at the given offset, including JSDoc documentation and tags.
   */
  getQuickInfo(
    path: string,
    offset: number,
  ): {
    text: string;
    documentation: string;
    tags: { name: string; text: string }[];
    start: number;
    length: number;
  } | null {
    if (!this.env || !this.hasSourceFile(path)) return null;
    const info = this.env.languageService.getQuickInfoAtPosition(path, offset);
    if (!info || !info.displayParts) return null;
    const joinParts = (parts: readonly ts.SymbolDisplayPart[] | undefined) =>
      Array.from(parts || [])
        .map((p) => p.text)
        .join("");
    const text = info.displayParts.map((p) => p.text).join("");
    const documentation = joinParts(info.documentation);
    const tags = Array.from(info.tags || []).map((tag) => ({
      name: tag.name,
      text: joinParts(tag.text),
    }));
    const { start, length } = info.textSpan;
    return { text, documentation, tags, start, length };
  }

  /**
   * Returns definition location at the given offset.
   */
  getDefinition(
    path: string,
    offset: number,
  ): { targetPath: string; targetOffset: number } | null {
    if (!this.env || !this.hasSourceFile(path)) return null;
    const refs = this.env.languageService.getDefinitionAtPosition(path, offset);
    if (!refs?.length) return null;
    const first = refs[0];
    return {
      targetPath: first.fileName,
      targetOffset: first.textSpan.start,
    };
  }

  /**
   * Returns all references to the symbol at the given offset.
   * Lib-file references (paths starting with `/lib.`) are filtered out.
   */
  getReferences(path: string, offset: number): Reference[] {
    if (!this.env || !this.hasSourceFile(path)) return [];
    const groups = this.env.languageService.findReferences(path, offset);
    if (!groups) return [];
    return groups.flatMap((group) =>
      group.references
        .filter((ref) => !ref.fileName.startsWith("/lib."))
        .map((ref) => ({
          path: ref.fileName,
          start: ref.textSpan.start,
          end: ref.textSpan.start + ref.textSpan.length,
        })),
    );
  }

  /**
   * Emits the entry file and returns output files plus diagnostics.
   */
  compile(entryPath: string): {
    files: { path: string; content: string }[];
    diagnostics: Diagnostic[];
  } {
    if (!this.env || !this.hasSourceFile(entryPath)) {
      return { files: [], diagnostics: [] };
    }
    const output = this.env.languageService.getEmitOutput(entryPath);
    const files = output.outputFiles.map((f) => ({
      path: f.name,
      content: f.text,
    }));
    const diagnostics = this.getDiagnostics(entryPath);
    return { files, diagnostics };
  }
}
