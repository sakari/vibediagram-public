/**
 * Jazz-backed implementation of the {@link AnnotationsBackend} contract from
 * `@diagram/draw-overlay`. It is the only Jazz consumer for the drawing
 * feature; the overlay package and the per-view packages stay
 * backend-agnostic.
 *
 * The adapter wraps a deeply-loaded `Annotations` CoMap (with `strokes` and
 * `cursors` resolved). Reads translate the CRDT shape to plain
 * `StrokeData` / `CursorTick` objects; writes translate the other way and
 * push to the underlying CoList / CoFeed via the `$jazz` mutation API.
 *
 * ## Snapshot stability
 *
 * The `AnnotationsBackend` contract requires `readStrokes` and
 * `readOtherCursors` to return a referentially-stable array between
 * subscriber notifications: `useSyncExternalStore` (used by the overlay's
 * hooks) compares snapshots with `Object.is` to decide whether to re-render
 * and will spin if a fresh array is returned every call.
 *
 * To honour that contract this adapter caches the last decoded array per
 * scope, alongside a "signature" computed from the underlying CoValue. The
 * cached array is reused as long as the signature is unchanged. When the
 * underlying data changes (a stroke is appended/cleared, a cursor tick is
 * pushed) the signature differs and the array is rebuilt.
 *
 * - Strokes signature: `length|<id-of-last-stroke>|<id-of-first-stroke>`.
 *   Strokes are append-only and never mutated, so a length change OR a
 *   change to the bounding ids reliably indicates a structural change.
 *   Splice-to-empty (clearStrokes) changes the length, so it is covered.
 * - Cursors signature: a join of `accountId@madeAt#t` for every entry in
 *   `perAccount` (own account excluded). `madeAt` is a Date object whose
 *   timestamp moves forward with every new tick from that account, and the
 *   embedded `t` (epoch ms) on the parsed payload disambiguates ties.
 *
 * ## Subscriptions
 *
 * Multiple callers may subscribe to strokes and/or cursors. We keep a
 * single Jazz subscription and fan out to all registered callbacks. The
 * Jazz subscription is started lazily when the first caller arrives and
 * torn down when the last caller leaves, mirroring
 * `JazzFileStoreAdapter.startSubscription` / `stopSubscriptionIfIdle`.
 */
import type {
  AnnotationsBackend,
  CursorTick,
  StrokeData,
  StrokeScope,
} from "@diagram/draw-overlay";
import { type co, type Account } from "jazz-tools";
import { Stroke, type Annotations } from "@diagram/jazz-schema";

/** Deeply-loaded shape that this adapter expects. */
type LoadedAnnotations = co.loaded<
  typeof Annotations,
  { strokes: { $each: true }; cursors: true }
>;

type ScopeKey = string;

const scopeKey = (scope: StrokeScope): ScopeKey =>
  `${scope.view}|${scope.filePath ?? ""}`;

/**
 * Cache entry for `readStrokes`. Holds the last decoded array and the
 * signature it was built from. A signature mismatch on the next read
 * triggers a rebuild.
 */
interface StrokeCacheEntry {
  signature: string;
  data: readonly StrokeData[];
}

interface CursorCacheEntry {
  signature: string;
  data: readonly CursorTick[];
}

export class JazzAnnotationsBackend implements AnnotationsBackend {
  private readonly strokeSubscribers = new Map<ScopeKey, Set<() => void>>();
  private readonly cursorSubscribers = new Map<ScopeKey, Set<() => void>>();
  private readonly strokeCache = new Map<ScopeKey, StrokeCacheEntry>();
  private readonly cursorCache = new Map<ScopeKey, CursorCacheEntry>();
  private unsubscribeJazz: (() => void) | null = null;

  constructor(
    private readonly annotations: LoadedAnnotations,
    private readonly me: Account,
  ) {}

  readStrokes(scope: StrokeScope): readonly StrokeData[] {
    const key = scopeKey(scope);
    const signature = this.computeStrokeSignature(scope);
    const cached = this.strokeCache.get(key);
    if (cached && cached.signature === signature) return cached.data;
    const data = this.buildStrokeSnapshot(scope);
    this.strokeCache.set(key, { signature, data });
    return data;
  }

  subscribeStrokes(scope: StrokeScope, cb: () => void): () => void {
    const key = scopeKey(scope);
    const existing = this.strokeSubscribers.get(key) ?? new Set<() => void>();
    existing.add(cb);
    this.strokeSubscribers.set(key, existing);
    this.startSubscription();
    return () => {
      existing.delete(cb);
      if (existing.size === 0) this.strokeSubscribers.delete(key);
      this.stopSubscriptionIfIdle();
    };
  }

  appendStroke(stroke: StrokeData): Promise<void> {
    // Strokes are owned by the same Group as the annotations container so
    // that public-write ACL applies — a reader of the project can still
    // append because the annotations Group is `everyone:"writer"`.
    const owner = this.annotations.$jazz.owner;
    const newStroke = Stroke.create(
      {
        id: stroke.id,
        view: stroke.view,
        ...(stroke.filePath === undefined ? {} : { filePath: stroke.filePath }),
        pointsJson: JSON.stringify(stroke.points),
        color: stroke.color,
        width: stroke.width,
        authorId: stroke.authorId,
        createdAt: new Date(stroke.createdAt).toISOString(),
      },
      { owner },
    );
    this.annotations.strokes.$jazz.push(newStroke);
    // Eagerly invalidate our local cache so a synchronous follow-up
    // readStrokes() returns a fresh snapshot. Subscribers will be notified
    // by the underlying Jazz subscription too.
    this.invalidateStrokeCache({
      view: stroke.view,
      filePath: stroke.filePath,
    });
    this.notifyStrokes({ view: stroke.view, filePath: stroke.filePath });
    return Promise.resolve();
  }

  clearStrokes(scope: StrokeScope): Promise<void> {
    const list = this.annotations.strokes;
    // Walk from the back so splice indices remain valid as we remove.
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (matchesScope(entry, scope)) {
        list.$jazz.splice(i, 1);
      }
    }
    this.invalidateStrokeCache(scope);
    this.notifyStrokes(scope);
    return Promise.resolve();
  }

  deleteStroke(strokeId: string): Promise<void> {
    const list = this.annotations.strokes;
    // Stroke ids are globally unique, so a single linear search suffices.
    // We walk forward and stop at the first match — there can be at most
    // one entry per id by construction.
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (entry.id !== strokeId) continue;
      const scope: StrokeScope = {
        view: entry.view,
        ...(entry.filePath === undefined ? {} : { filePath: entry.filePath }),
      };
      list.$jazz.splice(i, 1);
      this.invalidateStrokeCache(scope);
      this.notifyStrokes(scope);
      break;
    }
    return Promise.resolve();
  }

  writeCursorTick(tick: CursorTick): void {
    // CoFeed entries are JSON-encoded payloads (see Annotations schema).
    // The hook layer handles throttling; we write whatever we receive.
    this.annotations.cursors.$jazz.push(JSON.stringify(tick));
  }

  readOtherCursors(scope: StrokeScope): readonly CursorTick[] {
    const key = scopeKey(scope);
    const { signature, ticks } = this.collectOtherCursors(scope);
    const cached = this.cursorCache.get(key);
    if (cached && cached.signature === signature) return cached.data;
    this.cursorCache.set(key, { signature, data: ticks });
    return ticks;
  }

  subscribeCursors(scope: StrokeScope, cb: () => void): () => void {
    const key = scopeKey(scope);
    const existing = this.cursorSubscribers.get(key) ?? new Set<() => void>();
    existing.add(cb);
    this.cursorSubscribers.set(key, existing);
    this.startSubscription();
    return () => {
      existing.delete(cb);
      if (existing.size === 0) this.cursorSubscribers.delete(key);
      this.stopSubscriptionIfIdle();
    };
  }

  // --- internals ---------------------------------------------------------

  private computeStrokeSignature(scope: StrokeScope): string {
    const list = this.annotations.strokes;
    const ids: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (matchesScope(entry, scope)) ids.push(entry.$jazz.id);
    }
    // Length plus first/last id is sufficient to detect appends and clears
    // for an append-only list. A reorder would also flip the signature.
    const len = String(ids.length);
    return `${len}|${ids[0] ?? ""}|${ids[ids.length - 1] ?? ""}`;
  }

  private buildStrokeSnapshot(scope: StrokeScope): readonly StrokeData[] {
    const list = this.annotations.strokes;
    const out: StrokeData[] = [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!matchesScope(entry, scope)) continue;
      const decoded = decodeStroke(entry);
      // Skip strokes with malformed pointsJson — a peer with
      // everyone:"writer" access could push invalid JSON.
      if (decoded === null) continue;
      out.push(decoded);
    }
    return out;
  }

  private collectOtherCursors(scope: StrokeScope): {
    signature: string;
    ticks: readonly CursorTick[];
  } {
    const perAccount = this.annotations.cursors.perAccount;
    const ticks: CursorTick[] = [];
    const sigParts: string[] = [];
    const ownId = this.me.$jazz.id;
    for (const accountId of Object.keys(perAccount)) {
      if (accountId === ownId) continue;
      const entry = perAccount[accountId as keyof typeof perAccount];
      // perAccount can return undefined despite its type when the account
      // has no entries yet; guard defensively.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime can be undefined
      if (!entry) continue;
      const raw = entry.value;
      if (typeof raw !== "string") continue;
      const tick = parseCursorTick(raw);
      // Skip ticks with malformed payloads (peers can push arbitrary JSON).
      if (tick === null) continue;
      if (tick.view !== scope.view) continue;
      if ((tick.filePath ?? undefined) !== (scope.filePath ?? undefined)) {
        continue;
      }
      ticks.push(tick);
      const madeAt = String(entry.madeAt.getTime());
      const tStamp = String(tick.t);
      sigParts.push(`${accountId}@${madeAt}#${tStamp}`);
    }
    return { signature: sigParts.join("|"), ticks };
  }

  private invalidateStrokeCache(scope: StrokeScope): void {
    this.strokeCache.delete(scopeKey(scope));
  }

  private notifyStrokes(scope: StrokeScope): void {
    const subs = this.strokeSubscribers.get(scopeKey(scope));
    if (!subs) return;
    for (const cb of [...subs]) cb();
  }

  private notifyAllStrokes(): void {
    for (const [, subs] of this.strokeSubscribers) {
      for (const cb of [...subs]) cb();
    }
  }

  private notifyAllCursors(): void {
    for (const [, subs] of this.cursorSubscribers) {
      for (const cb of [...subs]) cb();
    }
  }

  private startSubscription(): void {
    if (this.unsubscribeJazz) return;
    if (
      this.strokeSubscribers.size === 0 &&
      this.cursorSubscribers.size === 0
    ) {
      return;
    }
    // A single Jazz subscription drives both stroke and cursor fanout.
    // Cache invalidation is wholesale on each tick: we drop both caches so
    // that the next read recomputes signatures and decides whether the
    // snapshot needs rebuilding. This is cheap relative to a real change.
    this.unsubscribeJazz = this.annotations.$jazz.subscribe(
      { resolve: { strokes: { $each: true }, cursors: true } },
      () => {
        this.strokeCache.clear();
        this.cursorCache.clear();
        this.notifyAllStrokes();
        this.notifyAllCursors();
      },
    );
  }

  private stopSubscriptionIfIdle(): void {
    if (this.strokeSubscribers.size > 0) return;
    if (this.cursorSubscribers.size > 0) return;
    this.unsubscribeJazz?.();
    this.unsubscribeJazz = null;
  }
}

/** True iff the stroke CoMap belongs to the (view, filePath) scope. */
function matchesScope(
  entry: co.loaded<typeof Stroke>,
  scope: StrokeScope,
): boolean {
  if (entry.view !== scope.view) return false;
  // Both undefined ⇒ match (diagram scope). Both equal strings ⇒ match.
  return (entry.filePath ?? undefined) === (scope.filePath ?? undefined);
}

function decodeStroke(entry: co.loaded<typeof Stroke>): StrokeData | null {
  const points = parseStrokePoints(entry.pointsJson);
  if (points === null) return null;
  return {
    id: entry.id,
    view: entry.view,
    ...(entry.filePath === undefined ? {} : { filePath: entry.filePath }),
    points,
    color: entry.color,
    width: entry.width,
    authorId: entry.authorId,
    createdAt: Date.parse(entry.createdAt),
  };
}

/**
 * Parse a stroke's `pointsJson` payload into `[number, number][]`.
 * Returns `null` on any parse error or shape mismatch — peers with
 * `everyone:"writer"` access can push arbitrary JSON; we must not crash
 * the React render path on a malformed payload.
 */
function parseStrokePoints(pointsJson: string): [number, number][] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(pointsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: [number, number][] = [];
  for (const item of parsed) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      typeof item[0] !== "number" ||
      typeof item[1] !== "number"
    ) {
      return null;
    }
    out.push([item[0], item[1]]);
  }
  return out;
}

/**
 * Parse a CoFeed cursor payload into a `CursorTick`. Returns `null` on
 * any parse error or shape mismatch (same threat model as
 * `parseStrokePoints` — peers can push arbitrary JSON).
 */
function parseCursorTick(raw: string): CursorTick | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed to non-null object above; we read each field defensively below
  const obj = parsed as Record<string, unknown>;
  if (obj.view !== "diagram" && obj.view !== "markdown") return null;
  if (typeof obj.x !== "number" || typeof obj.y !== "number") return null;
  if (typeof obj.drawing !== "boolean") return null;
  if (typeof obj.name !== "string") return null;
  if (typeof obj.t !== "number") return null;
  if (obj.filePath !== undefined && typeof obj.filePath !== "string") {
    return null;
  }
  return {
    view: obj.view,
    ...(typeof obj.filePath === "string" ? { filePath: obj.filePath } : {}),
    x: obj.x,
    y: obj.y,
    drawing: obj.drawing,
    name: obj.name,
    t: obj.t,
  };
}
