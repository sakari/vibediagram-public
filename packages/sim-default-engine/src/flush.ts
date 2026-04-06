declare class MessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
}
declare class MessagePort {
  onmessage: ((ev: unknown) => void) | null;
  postMessage(value: unknown): void;
}

/**
 * MessageChannel-based microtask flush. postMessage schedules a macrotask; the
 * runtime drains all pending microtasks (including .then() continuations) before
 * delivering that macrotask. The flush() promise resolves in the macrotask
 * handler, guaranteeing all microtasks queued before flush() have completed.
 */
export class MicrotaskFlush {
  private resolve: (() => void) | null = null;
  private port1: MessagePort;
  private port2: MessagePort;

  constructor() {
    const ch = new MessageChannel();
    this.port1 = ch.port1;
    this.port2 = ch.port2;
    this.port1.onmessage = () => {
      if (this.resolve) {
        this.resolve();
        this.resolve = null;
      }
    };
  }

  /**
   * Returns a promise that resolves after all pending microtasks have drained.
   */
  flush(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolve = resolve;
      this.port2.postMessage(null);
    });
  }
}
