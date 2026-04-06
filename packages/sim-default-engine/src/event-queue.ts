/**
 * Min-heap priority queue for delay events, ordered by (time, tiebreaker).
 * Used by the step engine to schedule delayed resolution of promises.
 */

export interface DelayEntry {
  time: number;
  tiebreaker: number;
  resolve: () => void;
}

function compare(a: DelayEntry, b: DelayEntry): number {
  return a.time - b.time || a.tiebreaker - b.tiebreaker;
}

export class EventQueue {
  private heap: DelayEntry[] = [];

  /**
   * Inserts an event into the queue. Ordering is by time first, then tiebreaker.
   */
  push(time: number, tiebreaker: number, resolve: () => void): void {
    const entry: DelayEntry = { time, tiebreaker, resolve };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * Removes and returns the minimum element. Throws if empty.
   */
  pop(): DelayEntry {
    if (this.heap.length === 0) {
      throw new Error("EventQueue.pop() called on empty queue");
    }
    const top = this.heap[0];
    const last = this.heap.pop();
    if (last === undefined) {
      throw new Error("EventQueue internal error: pop() returned undefined");
    }
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  /**
   * Returns the minimum element without removing it. undefined if empty.
   */
  peek(): DelayEntry | undefined {
    return this.heap[0];
  }

  /** Number of events in the queue. */
  get size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (compare(this.heap[index], this.heap[parentIndex]) >= 0) {
        break;
      }
      [this.heap[index], this.heap[parentIndex]] = [
        this.heap[parentIndex],
        this.heap[index],
      ];
      index = parentIndex;
    }
  }

  private sinkDown(index: number): void {
    const len = this.heap.length;
    for (;;) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < len && compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < len && compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      [this.heap[index], this.heap[smallest]] = [
        this.heap[smallest],
        this.heap[index],
      ];
      index = smallest;
    }
  }
}
