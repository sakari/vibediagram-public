/**
 * FileStore adapter backed by a Jazz DiagramProject. Wraps a loaded
 * DiagramProject CoMap and delegates read/write to CoList/CoPlainText
 * operations. Change events are emitted both when the adapter mutates
 * data locally and when Jazz asynchronously loads nested content.
 *
 * The Jazz subscription is self-managing: it starts when the first
 * onFileChange listener registers and stops when the last one unsubscribes.
 */
import type { FileStore, Unsubscribe } from "@diagram/editor";
import { co, type Group } from "jazz-tools";
import { FileEntry, type DiagramProject } from "./schema";

type FileChangeCallback = (path: string, content: string) => void;
type FileDeletedCallback = (path: string) => void;

export class JazzFileStoreAdapter implements FileStore {
  private readonly changeCallbacks: FileChangeCallback[] = [];
  private readonly createdCallbacks: FileChangeCallback[] = [];
  private readonly deletedCallbacks: FileDeletedCallback[] = [];
  private readonly lastSyncedContent = new Map<string, string>();
  private unsubscribeJazz: (() => void) | null = null;

  constructor(
    private readonly project: DiagramProject,
    private readonly group: Group,
  ) {}

  listFiles(): string[] {
    const files = this.project.files;
    if (!files) return [];
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry?.path) paths.push(entry.path);
    }
    return paths;
  }

  readFile(path: string): string | undefined {
    const entry = this.findEntry(path);
    if (!entry) return undefined;
    return entry.content?.toString();
  }

  writeFile(path: string, content: string): void {
    const entry = this.findEntry(path);
    if (entry) {
      if (entry.content) {
        entry.content.$jazz.applyDiff(content);
      }
      for (const cb of this.changeCallbacks) cb(path, content);
    } else {
      this.createFileEntry(path, content);
      for (const cb of this.createdCallbacks) cb(path, content);
    }
    this.project.$jazz.set("updatedAt", new Date().toISOString());
  }

  deleteFile(path: string): void {
    const files = this.project.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry?.path === path) {
        files.$jazz.splice(i, 1);
        for (const cb of this.deletedCallbacks) cb(path);
        this.project.$jazz.set("updatedAt", new Date().toISOString());
        return;
      }
    }
  }

  onFileChange(callback: FileChangeCallback): Unsubscribe {
    this.changeCallbacks.push(callback);
    this.startSubscription();
    return () => {
      const i = this.changeCallbacks.indexOf(callback);
      if (i !== -1) this.changeCallbacks.splice(i, 1);
      this.stopSubscriptionIfIdle();
    };
  }

  onFileCreated(callback: FileChangeCallback): Unsubscribe {
    this.createdCallbacks.push(callback);
    return () => {
      const i = this.createdCallbacks.indexOf(callback);
      if (i !== -1) this.createdCallbacks.splice(i, 1);
    };
  }

  onFileDeleted(callback: FileDeletedCallback): Unsubscribe {
    this.deletedCallbacks.push(callback);
    return () => {
      const i = this.deletedCallbacks.indexOf(callback);
      if (i !== -1) this.deletedCallbacks.splice(i, 1);
    };
  }

  private checkForUpdates(): void {
    const files = this.project.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (!entry?.path) continue;
      const content = entry.content?.toString();
      if (content === undefined) continue;
      const prev = this.lastSyncedContent.get(entry.path);
      if (prev === content) continue;
      this.lastSyncedContent.set(entry.path, content);
      for (const cb of this.changeCallbacks) cb(entry.path, content);
    }
  }

  private startSubscription(): void {
    if (this.unsubscribeJazz) return;
    this.unsubscribeJazz = this.project.$jazz.subscribe(
      { resolve: { files: { $each: { content: true } } } },
      () => {
        this.checkForUpdates();
      },
    );
  }

  private stopSubscriptionIfIdle(): void {
    if (this.changeCallbacks.length > 0) return;
    this.unsubscribeJazz?.();
    this.unsubscribeJazz = null;
  }

  private findEntry(path: string): co.loaded<typeof FileEntry> | undefined {
    const files = this.project.files;
    if (!files) return undefined;
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry?.path === path) return entry;
    }
    return undefined;
  }

  private createFileEntry(path: string, content: string): void {
    const files = this.project.files;
    if (!files) return;
    const owner = this.group;
    const entry = FileEntry.create(
      {
        path,
        content: co.plainText().create(content, { owner }),
      },
      { owner },
    );
    files.$jazz.push(entry);
  }
}
