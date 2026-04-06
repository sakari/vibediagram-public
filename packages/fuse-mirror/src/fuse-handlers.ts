import { co, type Group } from "jazz-tools";
import { FileEntry, type DiagramProject } from "@diagram/jazz-schema";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";

// POSIX error codes (avoids importing fuse-native at module level,
// which requires libfuse to be installed even for tests).
const ENOENT = 2;
const EIO = 5;
const EINVAL = 22;
const EEXIST = 17;
const EFBIG = 27;
const EACCES = 13;

// Flat single-level path: starts with /, no subdirs, no null/control chars.
const VALID_PATH_RE = /^\/[^\0\n\r/]+$/;
const MAX_PATH_LEN = 255;
const MAX_WRITE_OFFSET = 10 * 1024 * 1024; // 10 MB

interface WriteBuffer {
  content: string;
  dirty: boolean;
}

/**
 * FUSE filesystem handlers backed by a Jazz DiagramProject.
 * Intercepts filesystem operations and translates them to Jazz CRDT mutations.
 *
 * Supports read-only static files (e.g. type declarations) served alongside
 * the Jazz project files. Static files appear in directory listings and can
 * be read but not written, deleted, or renamed.
 */
export class FuseHandlers {
  private nextFd = 10;
  private readonly openFiles = new Map<number, string>(); // fd -> path
  private readonly writeBuffers = new Map<string, WriteBuffer>();
  private readonly dirtyPaths = new Set<string>();
  private readonly log: Logger;

  /** Read-only files served alongside Jazz project files. */
  private readonly staticFiles: ReadonlyMap<string, string>;

  /** Directories that must exist for staticFiles paths to be traversable. */
  private readonly staticDirs: ReadonlySet<string>;

  constructor(
    private readonly project: DiagramProject,
    private readonly group: Group,
    options?: { logger?: Logger; staticFiles?: Map<string, string> },
  ) {
    this.log = options?.logger ?? silentLogger;
    this.staticFiles = options?.staticFiles ?? new Map();
    this.staticDirs = FuseHandlers.buildDirSet(this.staticFiles);
  }

  /** Build the set of all ancestor directories for a set of file paths. */
  private static buildDirSet(files: ReadonlyMap<string, string>): Set<string> {
    const dirs = new Set<string>();
    for (const filePath of files.keys()) {
      const parts = filePath.split("/");
      // Build each ancestor: /a, /a/b, /a/b/c (skip last = filename)
      for (let i = 2; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }
    return dirs;
  }

  /** List immediate children of a directory from static files/dirs. */
  private staticChildrenOf(dirPath: string): string[] {
    const prefix = dirPath === "/" ? "/" : dirPath + "/";
    const children = new Set<string>();

    for (const filePath of this.staticFiles.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const firstSegment = rest.split("/")[0];
        children.add(firstSegment);
      }
    }
    for (const d of this.staticDirs) {
      if (d.startsWith(prefix)) {
        const rest = d.slice(prefix.length);
        if (!rest.includes("/")) {
          children.add(rest);
        }
      }
    }
    return [...children];
  }

  private isStaticDir(path: string): boolean {
    return this.staticDirs.has(path);
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

  private getContent(path: string): string | undefined {
    const buf = this.writeBuffers.get(path);
    if (buf) return buf.content;
    // Check static files
    const staticContent = this.staticFiles.get(path);
    if (staticContent !== undefined) return staticContent;
    const entry = this.findEntry(path);
    if (!entry) return undefined;
    return entry.content?.toString();
  }

  private listPaths(): string[] {
    const files = this.project.files;
    if (!files) return [];
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry?.path) paths.push(entry.path);
    }
    return paths;
  }

  /** Validate that a path is a safe single-level filename. */
  private static isValidPath(path: string): boolean {
    return path.length <= MAX_PATH_LEN && VALID_PATH_RE.test(path);
  }

  /** Count how many open fds reference the given path. */
  private openFdCount(path: string): number {
    let count = 0;
    for (const p of this.openFiles.values()) {
      if (p === path) count++;
    }
    return count;
  }

  private dirStat() {
    return {
      mtime: new Date(),
      atime: new Date(),
      ctime: new Date(),
      nlink: 1,
      size: 4096,
      mode: 0o40755, // directory
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
    };
  }

  private fileStat(size: number) {
    return {
      mtime: new Date(),
      atime: new Date(),
      ctime: new Date(),
      nlink: 1,
      size,
      mode: 0o100644, // regular file
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
    };
  }

  getOperations() {
    return {
      getattr: (path: string, cb: (code: number, stat?: object) => void) => {
        // Root or static directory
        if (path === "/" || this.isStaticDir(path)) {
          cb(0, this.dirStat());
          return;
        }

        const content = this.getContent(path);
        if (content === undefined) {
          cb(-ENOENT);
          return;
        }

        cb(0, this.fileStat(Buffer.byteLength(content, "utf8")));
      },

      readdir: (path: string, cb: (code: number, names?: string[]) => void) => {
        if (path === "/") {
          const jazzNames = this.listPaths().map((p) => p.replace(/^\//, ""));
          const staticNames = this.staticChildrenOf("/");
          const unique = [...new Set([...jazzNames, ...staticNames])];
          cb(0, unique);
          return;
        }

        // Static subdirectories
        if (this.isStaticDir(path)) {
          cb(0, this.staticChildrenOf(path));
          return;
        }

        cb(-ENOENT);
      },

      open: (
        path: string,
        _flags: number,
        cb: (code: number, fd?: number) => void,
      ) => {
        const content = this.getContent(path);
        if (content === undefined) {
          cb(-ENOENT);
          return;
        }

        const fd = this.nextFd++;
        this.openFiles.set(fd, path);
        cb(0, fd);
      },

      read: (
        path: string,
        _fd: number,
        buffer: Buffer,
        length: number,
        position: number,
        cb: (bytesRead: number) => void,
      ) => {
        const content = this.getContent(path);
        if (content === undefined) {
          cb(-ENOENT);
          return;
        }

        const buf = Buffer.from(content, "utf8");
        const pos = Math.max(0, position);
        const end = Math.min(buf.length, pos + length);
        if (pos >= buf.length) {
          cb(0);
          return;
        }

        const slice = buf.subarray(pos, end);
        slice.copy(buffer);
        cb(slice.length);
      },

      write: (
        _fusePath: string,
        fd: number,
        buffer: Buffer,
        length: number,
        position: number,
        cb: (bytesWritten: number) => void,
      ) => {
        // Resolve path from fd (more reliable than the FUSE-provided path)
        const path = this.openFiles.get(fd);
        if (!path) {
          cb(-ENOENT);
          return;
        }

        // Static files are read-only
        if (this.staticFiles.has(path)) {
          cb(-EACCES);
          return;
        }

        if (position + length > MAX_WRITE_OFFSET) {
          cb(-EFBIG);
          return;
        }

        let wb = this.writeBuffers.get(path);
        if (!wb) {
          const existing = this.getContent(path) ?? "";
          wb = { content: existing, dirty: true };
          this.writeBuffers.set(path, wb);
        }

        const data = buffer.subarray(0, length).toString("utf8");
        const contentBuf = Buffer.from(wb.content, "utf8");

        // Expand buffer if write extends beyond current content
        let newBuf: Buffer;
        const needed = position + length;
        if (needed > contentBuf.length) {
          newBuf = Buffer.alloc(needed);
          contentBuf.copy(newBuf);
        } else {
          newBuf = Buffer.from(contentBuf);
        }
        Buffer.from(data, "utf8").copy(newBuf, position);
        wb.content = newBuf.toString("utf8");
        wb.dirty = true;
        this.dirtyPaths.add(path);

        cb(length);
      },

      create: (
        path: string,
        _mode: number,
        cb: (code: number, fd?: number) => void,
      ) => {
        if (!FuseHandlers.isValidPath(path)) {
          cb(-EINVAL);
          return;
        }

        const files = this.project.files;
        if (!files) {
          cb(-EIO);
          return;
        }

        if (this.findEntry(path) || this.staticFiles.has(path)) {
          cb(-EEXIST);
          return;
        }

        const entry = FileEntry.create(
          {
            path,
            content: co.plainText().create("", { owner: this.group }),
          },
          { owner: this.group },
        );
        files.$jazz.push(entry);
        this.project.$jazz.set("updatedAt", new Date().toISOString());

        const fd = this.nextFd++;
        this.openFiles.set(fd, path);
        this.writeBuffers.set(path, { content: "", dirty: false });

        this.log.info("Created: %s", path);
        cb(0, fd);
      },

      unlink: (path: string, cb: (code: number) => void) => {
        if (this.staticFiles.has(path)) {
          cb(-EACCES);
          return;
        }

        const files = this.project.files;
        if (!files) {
          cb(-EIO);
          return;
        }

        for (let i = 0; i < files.length; i++) {
          const entry = files[i];
          if (entry?.path === path) {
            files.$jazz.splice(i, 1);
            this.writeBuffers.delete(path);
            this.dirtyPaths.delete(path);
            this.project.$jazz.set("updatedAt", new Date().toISOString());
            this.log.info("Deleted: %s", path);
            cb(0);
            return;
          }
        }
        cb(-ENOENT);
      },

      truncate: (path: string, size: number, cb: (code: number) => void) => {
        if (this.staticFiles.has(path)) {
          cb(-EACCES);
          return;
        }

        const content = this.getContent(path);
        if (content === undefined) {
          cb(-ENOENT);
          return;
        }

        const buf = Buffer.from(content, "utf8");
        const truncated = buf.subarray(0, size).toString("utf8");

        const wb = this.writeBuffers.get(path);
        if (wb) {
          wb.content = truncated;
          wb.dirty = true;
        } else {
          this.writeBuffers.set(path, { content: truncated, dirty: true });
        }
        this.dirtyPaths.add(path);
        cb(0);
      },

      ftruncate: (
        _fusePath: string,
        fd: number,
        size: number,
        cb: (code: number) => void,
      ) => {
        // Resolve path from fd (consistent with write handler)
        const path = this.openFiles.get(fd) ?? _fusePath;

        if (this.staticFiles.has(path)) {
          cb(-EACCES);
          return;
        }

        const content = this.getContent(path);
        if (content === undefined) {
          cb(-ENOENT);
          return;
        }

        const buf = Buffer.from(content, "utf8");
        const truncated = buf.subarray(0, size).toString("utf8");

        const wb = this.writeBuffers.get(path);
        if (wb) {
          wb.content = truncated;
          wb.dirty = true;
        } else {
          this.writeBuffers.set(path, { content: truncated, dirty: true });
        }
        this.dirtyPaths.add(path);
        cb(0);
      },

      flush: (path: string, _fd: number, cb: (code: number) => void) => {
        this.flushPath(path);
        cb(0);
      },

      release: (_fusePath: string, fd: number, cb: (code: number) => void) => {
        const path = this.openFiles.get(fd);
        if (path) {
          this.flushPath(path);
          this.openFiles.delete(fd);
          // Clean up write buffer only when no more fds reference this path
          if (this.openFdCount(path) === 0) {
            this.writeBuffers.delete(path);
          }
        }
        cb(0);
      },

      rename: (src: string, dest: string, cb: (code: number) => void) => {
        if (this.staticFiles.has(src)) {
          cb(-EACCES);
          return;
        }

        if (!FuseHandlers.isValidPath(dest)) {
          cb(-EINVAL);
          return;
        }

        const entry = this.findEntry(src);
        if (!entry) {
          cb(-ENOENT);
          return;
        }

        // If destination exists, remove it first (POSIX rename semantics)
        const existing = this.findEntry(dest);
        if (existing) {
          const files = this.project.files;
          if (files) {
            for (let i = 0; i < files.length; i++) {
              if (files[i]?.path === dest) {
                files.$jazz.splice(i, 1);
                break;
              }
            }
          }
        }

        entry.$jazz.set("path", dest);

        // Update all open fds that reference the old path
        for (const [fd, p] of this.openFiles) {
          if (p === src) {
            this.openFiles.set(fd, dest);
          }
        }

        // Move any write buffer
        const wb = this.writeBuffers.get(src);
        if (wb) {
          this.writeBuffers.delete(src);
          this.writeBuffers.set(dest, wb);
        }
        if (this.dirtyPaths.has(src)) {
          this.dirtyPaths.delete(src);
          this.dirtyPaths.add(dest);
        }

        this.project.$jazz.set("updatedAt", new Date().toISOString());
        this.log.info("Renamed: %s -> %s", src, dest);
        cb(0);
      },

      statfs: (_path: string, cb: (code: number, stat?: object) => void) => {
        cb(0, {
          bsize: 4096,
          frsize: 4096,
          blocks: 1000000,
          bfree: 500000,
          bavail: 500000,
          files: 1000000,
          ffree: 999999,
          favail: 999999,
          fsid: 0,
          flag: 0,
          namemax: 255,
        });
      },
    };
  }

  private flushPath(path: string): void {
    const wb = this.writeBuffers.get(path);
    if (!wb?.dirty) return;

    const entry = this.findEntry(path);
    if (entry?.content) {
      entry.content.$jazz.applyDiff(wb.content);
      this.project.$jazz.set("updatedAt", new Date().toISOString());
      this.log.debug(
        "Synced to Jazz: %s (%d bytes)",
        path,
        Buffer.byteLength(wb.content, "utf8"),
      );
    }

    // Only clear dirty flag; buffer stays alive until all fds are released
    wb.dirty = false;
    this.dirtyPaths.delete(path);
  }
}
