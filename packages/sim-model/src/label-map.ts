/**
 * LabelMap: a Map keyed by sorted label sets (Record<string, string>).
 * Two label objects with the same key-value pairs in any order map to the
 * same entry.
 */

function labelKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}\0${labels[k]}`).join("\0");
}

export class LabelMap<T> {
  private map = new Map<string, { labels: Record<string, string>; data: T }>();

  get(labels: Record<string, string>): T | undefined {
    const entry = this.map.get(labelKey(labels));
    return entry?.data;
  }

  getOrCreate(labels: Record<string, string>, init: () => T): T {
    const key = labelKey(labels);
    let entry = this.map.get(key);
    if (!entry) {
      entry = { labels: { ...labels }, data: init() };
      this.map.set(key, entry);
    }
    return entry.data;
  }

  [Symbol.iterator](): IterableIterator<{
    labels: Record<string, string>;
    data: T;
  }> {
    return this.map.values();
  }

  get size(): number {
    return this.map.size;
  }
}
