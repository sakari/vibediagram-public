import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

/**
 * Returns the CodeMirror theme extension for the given theme.
 * Light mode uses the default (no extra styling). Dark mode uses oneDark.
 */
export function getThemeExtension(theme: "light" | "dark"): Extension {
  if (theme === "dark") return oneDark;
  return EditorView.theme({});
}
