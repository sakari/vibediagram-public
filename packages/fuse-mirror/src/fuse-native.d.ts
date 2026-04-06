declare module "fuse-native" {
  interface FuseOperations {
    getattr?(path: string, cb: (code: number, stat?: object) => void): void;
    readdir?(path: string, cb: (code: number, names?: string[]) => void): void;
    open?(
      path: string,
      flags: number,
      cb: (code: number, fd?: number) => void,
    ): void;
    read?(
      path: string,
      fd: number,
      buffer: Buffer,
      length: number,
      position: number,
      cb: (bytesRead: number) => void,
    ): void;
    write?(
      path: string,
      fd: number,
      buffer: Buffer,
      length: number,
      position: number,
      cb: (bytesWritten: number) => void,
    ): void;
    create?(
      path: string,
      mode: number,
      cb: (code: number, fd?: number) => void,
    ): void;
    unlink?(path: string, cb: (code: number) => void): void;
    truncate?(path: string, size: number, cb: (code: number) => void): void;
    ftruncate?(
      path: string,
      fd: number,
      size: number,
      cb: (code: number) => void,
    ): void;
    flush?(path: string, fd: number, cb: (code: number) => void): void;
    release?(path: string, fd: number, cb: (code: number) => void): void;
    rename?(src: string, dest: string, cb: (code: number) => void): void;
    statfs?(path: string, cb: (code: number, stat?: object) => void): void;
  }

  interface FuseOptions {
    force?: boolean;
    mkdir?: boolean;
    debug?: boolean;
    allowOther?: boolean;
  }

  class Fuse {
    static ENOENT: number;
    static EIO: number;
    static EPERM: number;
    static EACCES: number;
    static isConfigured(
      cb: (err: Error | null, configured: boolean) => void,
    ): void;

    constructor(mountPath: string, ops: FuseOperations, options?: FuseOptions);
    mount(cb: (err: Error | null) => void): void;
    unmount(cb: (err: Error | null) => void): void;
  }

  export = Fuse;
}
