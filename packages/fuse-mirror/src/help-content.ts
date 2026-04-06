/**
 * Generates read-only help files for the FUSE mount.
 *
 * Delegates to @diagram/ts-worker's generateHelpEntries() which is the
 * single source of truth for help content (shared with the browser editor).
 */

import { generateHelpEntries } from "@diagram/ts-worker/vite-plugin-help-files";

export function generateHelpFiles(): Map<string, string> {
  const entries = generateHelpEntries();
  return new Map(entries.map((e) => [e.path, e.content]));
}
