/**
 * Async FIFO semaphore.
 *
 * Every caller enqueues — there is no fast lane that lets a fresh acquirer
 * step ahead of waiters already in the queue. Admission decisions read
 * capacity live, so changes to capacity (up or down) take effect on the next
 * admission and the bound `active <= capacity` is never violated.
 */

interface SemaphoreTicket {
  /** Resolves once this caller has been admitted. */
  readonly admitted: Promise<void>;
  /**
   * Cancel a still-queued ticket. Returns true if the ticket was removed
   * from the queue; returns false if the caller was already admitted (in
   * which case `release()` must be called once the work completes).
   */
  cancel(): boolean;
}

export class AsyncSemaphore {
  private waiters: Array<() => void> = [];
  private active = 0;

  constructor(private readonly capacity: () => number) {}

  acquire(): SemaphoreTicket {
    let resolveFn!: () => void;
    const admitted = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
    this.waiters.push(resolveFn);
    this.advance();
    return {
      admitted,
      cancel: () => {
        const idx = this.waiters.indexOf(resolveFn);
        if (idx === -1) return false;
        this.waiters.splice(idx, 1);
        return true;
      },
    };
  }

  release(): void {
    if (this.active <= 0) return;
    this.active--;
    this.advance();
  }

  get inUse(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }

  private advance(): void {
    while (this.active < this.capacity() && this.waiters.length > 0) {
      this.active++;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}
