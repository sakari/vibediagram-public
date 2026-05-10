import type {
  AnnotationsBackend,
  CursorTick,
  StrokeData,
  StrokeScope,
} from "../types";

/**
 * Test-only in-memory implementation of {@link AnnotationsBackend}.
 *
 * Why this lives in `src/test-helpers/`: package consumers must not
 * pull this in via the public entry — it has no real persistence,
 * no async sync, and no production guarantees. Tests inside this
 * package import it directly via a relative path; it is intentionally
 * NOT re-exported from `src/index.ts`.
 *
 * Behaviour notes:
 * - Stroke and cursor state is keyed by `${view}|${filePath ?? ''}`.
 * - Mutations notify subscribers synchronously, before the mutating
 *   call returns. Tests can therefore assert on `read*` immediately
 *   after `writeTick` / `appendStroke`.
 * - `readStrokes` and `readOtherCursors` return the SAME array
 *   reference until the next mutation. This satisfies the snapshot
 *   stability contract that `useSyncExternalStore` requires (see
 *   `AnnotationsBackend` JSDoc in `../types.ts`).
 */
type ScopeKey = string;

const scopeKey = (scope: StrokeScope): ScopeKey =>
  `${scope.view}|${scope.filePath ?? ""}`;

const EMPTY_STROKES: readonly StrokeData[] = Object.freeze([]);
const EMPTY_CURSORS: readonly CursorTick[] = Object.freeze([]);

export class InMemoryAnnotationsBackend implements AnnotationsBackend {
  private readonly strokesByScope = new Map<ScopeKey, readonly StrokeData[]>();
  private readonly strokeSubscribers = new Map<ScopeKey, Set<() => void>>();
  // Per-scope, per-author latest tick (mirrors a "session feed" shape:
  // one most-recent tick per author, indexed by author id).
  private readonly cursorsByScope = new Map<
    ScopeKey,
    Map<string, CursorTick>
  >();
  // Cached snapshot of "other cursors" (filtered to exclude `ownAuthorId`)
  // per scope, kept in sync with `cursorsByScope`. Held so that
  // `readOtherCursors` returns a stable reference until the next write.
  private readonly otherCursorsSnapshot = new Map<
    ScopeKey,
    readonly CursorTick[]
  >();
  private readonly cursorSubscribers = new Map<ScopeKey, Set<() => void>>();

  constructor(
    private readonly ownAuthorId: string,
    /**
     * When a remote viewer writes a cursor tick, the backend has to
     * key it by *some* author identity. In production this is the
     * authenticated account ID; in tests we accept an arbitrary string
     * per writer via `writeCursorTickAs` so a single backend instance
     * can act as both "us" and "them". Defaults to `ownAuthorId` for
     * the local `writeCursorTick` path.
     */
  ) {}

  readStrokes(scope: StrokeScope): readonly StrokeData[] {
    return this.strokesByScope.get(scopeKey(scope)) ?? EMPTY_STROKES;
  }

  subscribeStrokes(scope: StrokeScope, cb: () => void): () => void {
    const key = scopeKey(scope);
    const existing = this.strokeSubscribers.get(key) ?? new Set<() => void>();
    existing.add(cb);
    this.strokeSubscribers.set(key, existing);
    return () => {
      existing.delete(cb);
    };
  }

  appendStroke(stroke: StrokeData): Promise<void> {
    const key = scopeKey({ view: stroke.view, filePath: stroke.filePath });
    const current = this.strokesByScope.get(key) ?? EMPTY_STROKES;
    this.strokesByScope.set(key, [...current, stroke]);
    this.notify(this.strokeSubscribers.get(key));
    return Promise.resolve();
  }

  clearStrokes(scope: StrokeScope): Promise<void> {
    const key = scopeKey(scope);
    if (!this.strokesByScope.has(key)) {
      return Promise.resolve();
    }
    this.strokesByScope.set(key, EMPTY_STROKES);
    this.notify(this.strokeSubscribers.get(key));
    return Promise.resolve();
  }

  deleteStroke(strokeId: string): Promise<void> {
    // Walk every scope bucket: stroke ids are globally unique, so the
    // matching entry lives in at most one bucket. We notify only the
    // subscribers of the affected scope (no fanout to unrelated scopes).
    for (const [key, strokes] of this.strokesByScope) {
      const idx = strokes.findIndex((s) => s.id === strokeId);
      if (idx === -1) continue;
      const next = [...strokes.slice(0, idx), ...strokes.slice(idx + 1)];
      this.strokesByScope.set(key, next);
      this.notify(this.strokeSubscribers.get(key));
      return Promise.resolve();
    }
    return Promise.resolve();
  }

  writeCursorTick(tick: CursorTick): void {
    this.writeCursorTickAs(this.ownAuthorId, tick);
  }

  /**
   * Test helper: write a tick under a specific author key. Used to
   * simulate a remote viewer without spinning up a second backend.
   */
  writeCursorTickAs(authorId: string, tick: CursorTick): void {
    const scope: StrokeScope = { view: tick.view, filePath: tick.filePath };
    const key = scopeKey(scope);
    const perAuthor =
      this.cursorsByScope.get(key) ?? new Map<string, CursorTick>();
    perAuthor.set(authorId, tick);
    this.cursorsByScope.set(key, perAuthor);
    this.refreshOtherCursorsSnapshot(key, perAuthor);
    this.notify(this.cursorSubscribers.get(key));
  }

  readOtherCursors(scope: StrokeScope): readonly CursorTick[] {
    return this.otherCursorsSnapshot.get(scopeKey(scope)) ?? EMPTY_CURSORS;
  }

  subscribeCursors(scope: StrokeScope, cb: () => void): () => void {
    const key = scopeKey(scope);
    const existing = this.cursorSubscribers.get(key) ?? new Set<() => void>();
    existing.add(cb);
    this.cursorSubscribers.set(key, existing);
    return () => {
      existing.delete(cb);
    };
  }

  private refreshOtherCursorsSnapshot(
    key: ScopeKey,
    perAuthor: Map<string, CursorTick>,
  ): void {
    const others: CursorTick[] = [];
    for (const [authorId, tick] of perAuthor) {
      if (authorId !== this.ownAuthorId) {
        others.push(tick);
      }
    }
    this.otherCursorsSnapshot.set(key, others);
  }

  private notify(subscribers: Set<() => void> | undefined): void {
    if (!subscribers) return;
    // Iterate a copy so a callback that unsubscribes itself doesn't
    // mutate the set we are walking.
    for (const cb of [...subscribers]) {
      cb();
    }
  }
}
