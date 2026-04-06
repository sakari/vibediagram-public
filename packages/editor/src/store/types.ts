/** Callback unsubscribe function. */
export type Unsubscribe = () => void;

/**
 * Storage adapter for virtual files. The editor reads/writes through this
 * interface; the consumer provides an implementation (e.g. Jazz-backed).
 */
export interface FileStore {
  listFiles(): string[];
  readFile(path: string): string | undefined;
  writeFile(path: string, content: string): void;
  deleteFile(path: string): void;
  onFileChange(callback: (path: string, content: string) => void): Unsubscribe;
  onFileCreated(callback: (path: string, content: string) => void): Unsubscribe;
  onFileDeleted(callback: (path: string) => void): Unsubscribe;
}
