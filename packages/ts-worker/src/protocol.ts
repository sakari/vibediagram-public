/** Diagnostic from the TypeScript compiler. */
export interface Diagnostic {
  message: string;
  start: number;
  end: number;
  severity: "error" | "warning" | "info";
}

/** Completion item for autocomplete. */
export interface Completion {
  label: string;
  kind: string;
  detail?: string;
  insertText?: string;
  sortText?: string;
}

/** A single reference location returned by find-references. */
export interface Reference {
  path: string;
  start: number;
  end: number;
}

/** Request sent from main thread to worker. */
export type WorkerRequest =
  | {
      type: "init";
      id: string;
      compilerOptions: Record<string, unknown>;
      extraLibs?: { path: string; content: string }[];
    }
  | { type: "sync-file"; id: string; path: string; content: string }
  | { type: "delete-file"; id: string; path: string }
  | { type: "get-diagnostics"; id: string; path: string }
  | { type: "get-completions"; id: string; path: string; offset: number }
  | { type: "get-quickinfo"; id: string; path: string; offset: number }
  | { type: "get-definition"; id: string; path: string; offset: number }
  | { type: "get-references"; id: string; path: string; offset: number }
  | { type: "compile"; id: string; entryPath: string };

/** Response sent from worker to main thread (reply to a request). */
export type WorkerResponse =
  | { type: "init-done"; id: string; tsVersion: string }
  | { type: "file-synced"; id: string; path: string }
  | { type: "file-deleted"; id: string; path: string }
  | { type: "diagnostics"; id: string; path: string; diagnostics: Diagnostic[] }
  | { type: "completions"; id: string; completions: Completion[] }
  | {
      type: "quickinfo";
      id: string;
      text: string;
      documentation: string;
      tags: { name: string; text: string }[];
      start: number;
      length: number;
    }
  | { type: "definition"; id: string; targetPath: string; targetOffset: number }
  | { type: "references"; id: string; references: Reference[] }
  | {
      type: "compiled";
      id: string;
      files: { path: string; content: string }[];
      diagnostics: Diagnostic[];
    }
  | { type: "error"; id: string; message: string };

/** Push message from worker to main (not a reply). */
export type WorkerPush = {
  type: "diagnostics-updated";
  path: string;
  diagnostics: Diagnostic[];
};

/** All messages sent from worker to main thread. */
export type WorkerMessage = WorkerResponse | WorkerPush;
