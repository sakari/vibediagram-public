import type {
  Diagnostic,
  Reference,
  WorkerRequest,
  WorkerResponse,
  WorkerPush,
} from "./protocol.js";

/** Minimal Worker interface required by WorkerClient. */
export interface WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

type PendingEntry = {
  handle: (res: WorkerResponse) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

/**
 * Main-thread client that wraps a Worker instance.
 * Each method posts a request and returns a Promise that resolves when the matching response arrives.
 */
export class WorkerClient {
  private pending = new Map<string, PendingEntry>();
  private idCounter = 0;

  /** Callback for push messages (diagnostics-updated). Not a reply to a request. */
  onDiagnosticsUpdated:
    | ((path: string, diagnostics: Diagnostic[]) => void)
    | null = null;

  /** @param worker - The Worker instance to wrap (e.g. from `new Worker(url, { type: "module" })`). */
  constructor(private worker: WorkerLike) {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse | WorkerPush>) => {
      const msg = e.data;
      if ("id" in msg && msg.id && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timeoutId);
        if (msg.type === "error") {
          entry.reject(new Error(msg.message));
        } else {
          try {
            entry.handle(msg);
          } catch (err) {
            entry.reject(err);
          }
        }
      } else if (msg.type === "diagnostics-updated") {
        this.onDiagnosticsUpdated?.(msg.path, msg.diagnostics);
      }
    };
  }

  private nextId(): string {
    return `req-${String(++this.idCounter)}`;
  }

  private post<T>(
    makeRequest: (id: string) => WorkerRequest,
    extract: (res: WorkerResponse) => T,
  ): Promise<T> {
    const id = this.nextId();
    const req = makeRequest(id);
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Worker request timed out"));
        }
      }, 30000);
      this.pending.set(id, {
        handle: (res) => {
          resolve(extract(res));
        },
        reject,
        timeoutId,
      });
      this.worker.postMessage(req);
    });
  }

  /** Initialize the worker with compiler options. Lib files are loaded inside the worker. */
  init(
    compilerOptions: Record<string, unknown>,
    extraLibs?: { path: string; content: string }[],
  ): Promise<{ tsVersion: string }> {
    return this.post(
      (id) => ({ type: "init", id, compilerOptions, extraLibs }),
      (res) => {
        if (res.type !== "init-done") throw new Error("Unexpected response");
        return { tsVersion: res.tsVersion };
      },
    );
  }

  /** Sync a file's content. */
  syncFile(path: string, content: string): Promise<void> {
    return this.post(
      (id) => ({ type: "sync-file", id, path, content }),
      () => undefined,
    );
  }

  /** Remove a file. */
  deleteFile(path: string): Promise<void> {
    return this.post(
      (id) => ({ type: "delete-file", id, path }),
      () => undefined,
    );
  }

  /** Get diagnostics for a file. */
  getDiagnostics(path: string): Promise<Diagnostic[]> {
    return this.post(
      (id) => ({ type: "get-diagnostics", id, path }),
      (res) => {
        if (res.type !== "diagnostics") throw new Error("Unexpected response");
        return res.diagnostics;
      },
    );
  }

  /** Get completions at offset. */
  getCompletions(path: string, offset: number) {
    return this.post(
      (id) => ({ type: "get-completions", id, path, offset }),
      (res) => {
        if (res.type !== "completions") throw new Error("Unexpected response");
        return res.completions;
      },
    );
  }

  /** Get quick info (hover) at offset, including JSDoc documentation and tags. */
  getQuickInfo(
    path: string,
    offset: number,
  ): Promise<{
    text: string;
    documentation: string;
    tags: { name: string; text: string }[];
    start: number;
    length: number;
  } | null> {
    return this.post(
      (id) => ({ type: "get-quickinfo", id, path, offset }),
      (res) => {
        if (res.type !== "quickinfo") throw new Error("Unexpected response");
        return res.text
          ? {
              text: res.text,
              documentation: res.documentation,
              tags: res.tags,
              start: res.start,
              length: res.length,
            }
          : null;
      },
    );
  }

  /** Get definition at offset. */
  getDefinition(
    path: string,
    offset: number,
  ): Promise<{ targetPath: string; targetOffset: number } | null> {
    return this.post(
      (id) => ({ type: "get-definition", id, path, offset }),
      (res) => {
        if (res.type !== "definition") throw new Error("Unexpected response");
        return res.targetPath
          ? { targetPath: res.targetPath, targetOffset: res.targetOffset }
          : null;
      },
    );
  }

  /** Find all references to the symbol at offset. */
  getReferences(path: string, offset: number): Promise<Reference[]> {
    return this.post(
      (id) => ({ type: "get-references", id, path, offset }),
      (res) => {
        if (res.type !== "references") throw new Error("Unexpected response");
        return res.references;
      },
    );
  }

  /** Compile entry file and return emitted files and diagnostics. */
  compile(entryPath: string): Promise<{
    files: { path: string; content: string }[];
    diagnostics: Diagnostic[];
  }> {
    return this.post(
      (id) => ({ type: "compile", id, entryPath }),
      (res) => {
        if (res.type !== "compiled") throw new Error("Unexpected response");
        return { files: res.files, diagnostics: res.diagnostics };
      },
    );
  }

  /** Terminate the worker. */
  terminate(): void {
    this.worker.terminate();
  }
}
