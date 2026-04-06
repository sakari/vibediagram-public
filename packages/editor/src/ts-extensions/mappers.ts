import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Completion as CmCompletion } from "@codemirror/autocomplete";
import type { Diagnostic, Completion } from "@diagram/ts-worker";

/**
 * Maps a TS worker Diagnostic to CodeMirror's Diagnostic format.
 */
export function mapDiagnostic(d: Diagnostic): CmDiagnostic {
  return {
    from: d.start,
    to: d.end,
    message: d.message,
    severity: d.severity,
  };
}

/**
 * Converts TypeScript sortText to a CodeMirror boost value.
 * TS sortText is a lexicographic string where lower = higher priority.
 * CM boost is a number where higher = shown first (default 0).
 * parseInt extracts the leading numeric priority tier and negates it.
 */
export function sortTextToBoost(sortText: string | undefined): number {
  if (sortText == null) return 0;
  const n = parseInt(sortText, 10);
  if (Number.isNaN(n) || n === 0) return 0;
  return -n;
}

/**
 * Maps a TS worker Completion to CodeMirror's Completion format.
 * The `from` position is used for the apply function to replace the correct range.
 */
export function mapCompletion(c: Completion, _from: number): CmCompletion {
  const text = c.insertText ?? c.label;
  return {
    label: c.label,
    type: c.kind,
    detail: c.detail,
    apply: text,
    boost: sortTextToBoost(c.sortText),
  };
}
