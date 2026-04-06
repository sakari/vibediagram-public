import type { FileStore, Unsubscribe } from "./types.js";

type FileChangeCallback = (path: string, content: string) => void;
type FileDeletedCallback = (path: string) => void;

/**
 * In-memory FileStore backed by a Map. Suitable for tests and ephemeral
 * editor sessions. Emits change/created/deleted callbacks according to
 * the FileStore contract.
 */
export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, string>();
  private readonly changeCallbacks: FileChangeCallback[] = [];
  private readonly createdCallbacks: FileChangeCallback[] = [];
  private readonly deletedCallbacks: FileDeletedCallback[] = [];

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(path, content);
      }
    }
  }

  /** Returns all file paths in the store. */
  listFiles(): string[] {
    return [...this.files.keys()];
  }

  /** Returns file content or undefined if the path does not exist. */
  readFile(path: string): string | undefined {
    return this.files.get(path);
  }

  /** Creates or updates a file. Emits onFileCreated for new files, onFileChange for updates. */
  writeFile(path: string, content: string): void {
    const existed = this.files.has(path);
    this.files.set(path, content);
    if (existed) {
      for (const cb of this.changeCallbacks) cb(path, content);
    } else {
      for (const cb of this.createdCallbacks) cb(path, content);
    }
  }

  /** Removes a file. Emits onFileDeleted. No-op if the path does not exist. */
  deleteFile(path: string): void {
    if (!this.files.has(path)) return;
    this.files.delete(path);
    for (const cb of this.deletedCallbacks) cb(path);
  }

  /** Registers a callback for updates to existing files. Returns unsubscribe. */
  onFileChange(callback: FileChangeCallback): Unsubscribe {
    this.changeCallbacks.push(callback);
    return () => {
      const i = this.changeCallbacks.indexOf(callback);
      if (i !== -1) this.changeCallbacks.splice(i, 1);
    };
  }

  /** Registers a callback for newly created files. Returns unsubscribe. */
  onFileCreated(callback: FileChangeCallback): Unsubscribe {
    this.createdCallbacks.push(callback);
    return () => {
      const i = this.createdCallbacks.indexOf(callback);
      if (i !== -1) this.createdCallbacks.splice(i, 1);
    };
  }

  /** Registers a callback for deleted files. Returns unsubscribe. */
  onFileDeleted(callback: FileDeletedCallback): Unsubscribe {
    this.deletedCallbacks.push(callback);
    return () => {
      const i = this.deletedCallbacks.indexOf(callback);
      if (i !== -1) this.deletedCallbacks.splice(i, 1);
    };
  }
}
