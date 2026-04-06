import { describe, it, expect } from "vitest";
import { mapDiagnostic, mapCompletion, sortTextToBoost } from "./mappers.js";
import type { Diagnostic, Completion } from "@diagram/ts-worker";

describe("mapDiagnostic", () => {
  it("maps worker Diagnostic to CodeMirror Diagnostic with from/to and severity", () => {
    const d: Diagnostic = {
      message: "Cannot find name 'x'",
      start: 10,
      end: 15,
      severity: "error",
    };
    const result = mapDiagnostic(d);
    expect(result).toEqual({
      from: 10,
      to: 15,
      message: "Cannot find name 'x'",
      severity: "error",
    });
  });

  it("preserves warning and info severities", () => {
    expect(
      mapDiagnostic({ message: "w", start: 0, end: 1, severity: "warning" })
        .severity,
    ).toBe("warning");
    expect(
      mapDiagnostic({ message: "i", start: 0, end: 1, severity: "info" })
        .severity,
    ).toBe("info");
  });
});

describe("mapCompletion", () => {
  it("maps worker Completion to CodeMirror Completion with label, type, detail", () => {
    const c: Completion = {
      label: "concat",
      kind: "function",
      detail: "(...items: string[]) => string",
    };
    const result = mapCompletion(c, 5);
    expect(result.label).toBe("concat");
    expect(result.type).toBe("function");
    expect(result.detail).toBe("(...items: string[]) => string");
    expect(result.apply).toBe("concat");
  });

  it("uses insertText when provided, otherwise label", () => {
    const withInsert: Completion = {
      label: "const",
      kind: "keyword",
      insertText: "const ",
    };
    expect(mapCompletion(withInsert, 0).apply).toBe("const ");

    const withoutInsert: Completion = {
      label: "foo",
      kind: "variable",
    };
    expect(mapCompletion(withoutInsert, 0).apply).toBe("foo");
  });

  it("sets boost from sortText", () => {
    const c: Completion = {
      label: "result",
      kind: "variable",
      sortText: "0",
    };
    expect(mapCompletion(c, 0).boost).toBe(0);

    const global: Completion = {
      label: "Array",
      kind: "class",
      sortText: "11",
    };
    expect(mapCompletion(global, 0).boost).toBe(-11);
  });

  it("defaults boost to 0 when sortText is missing", () => {
    const c: Completion = { label: "foo", kind: "variable" };
    expect(mapCompletion(c, 0).boost).toBe(0);
  });
});

describe("sortTextToBoost", () => {
  it("returns 0 for undefined", () => {
    expect(sortTextToBoost(undefined)).toBe(0);
  });

  it("negates the leading numeric portion", () => {
    expect(sortTextToBoost("0")).toBe(0);
    expect(sortTextToBoost("1")).toBe(-1);
    expect(sortTextToBoost("11")).toBe(-11);
    expect(sortTextToBoost("15")).toBe(-15);
  });

  it("handles sortText with trailing non-numeric characters", () => {
    expect(sortTextToBoost("0\u0000result")).toBe(0);
    expect(sortTextToBoost("11\u0000Array")).toBe(-11);
  });

  it("returns 0 for non-numeric sortText", () => {
    expect(sortTextToBoost("abc")).toBe(0);
    expect(sortTextToBoost("")).toBe(0);
  });
});
