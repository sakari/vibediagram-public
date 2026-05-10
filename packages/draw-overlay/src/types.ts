/**
 * Public types for the @diagram/draw-overlay package.
 *
 * These are the contract between the SVG overlay (added in a later task)
 * and any concrete annotations backend (e.g. a CRDT adapter, a
 * WebSocket adapter, or the in-memory test helper). The overlay package
 * itself only depends on `react` — every persistence concern is hidden
 * behind {@link AnnotationsBackend}.
 */

/**
 * Which view a stroke or cursor belongs to.
 *
 * - `"diagram"` strokes live in the diagram's flow-world coordinate space
 *   and pan/zoom with the diagram.
 * - `"markdown"` strokes live in the markdown scroll container's content
 *   coordinate space and are scoped per file.
 */
export type StrokeView = "diagram" | "markdown";

/**
 * A single sampled point of a freehand stroke, as `[x, y]` in the view's
 * content coordinate space.
 */
export type Point = readonly [number, number];

/**
 * Identifies the surface a backend operation applies to. `filePath` is
 * required for markdown scopes and omitted for diagram scopes.
 */
export interface StrokeScope {
  view: StrokeView;
  filePath?: string;
}

/**
 * Plain (backend-agnostic) representation of a completed stroke. The overlay
 * mints a `crypto.randomUUID()` `id` before calling
 * {@link AnnotationsBackend.appendStroke} so that a backend can dedupe
 * an optimistic local append against a remote echo of the same stroke.
 */
export interface StrokeData {
  id: string;
  view: StrokeView;
  filePath?: string;
  points: Point[];
  color: string;
  width: number;
  authorId: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/**
 * A single live-cursor sample emitted by one viewer. Consumers hide
 * ticks where `Date.now() - t > 2000` (no backend TTL exists for
 * CoFeeds, so the staleness check is mandatory at read time).
 */
export interface CursorTick {
  view: StrokeView;
  filePath?: string;
  x: number;
  y: number;
  drawing: boolean;
  /** Display name of the author (already resolved from profile). */
  name: string;
  /** Epoch milliseconds. */
  t: number;
}

/**
 * Adapter that translates between the overlay's drawing surface (in DOM
 * client pixels) and the underlying view's content coordinate space.
 *
 * Each view supplies its own implementation:
 * - The diagram view wraps `useReactFlow()`'s `screenToFlowPosition` /
 *   `flowToScreenPosition`.
 * - The markdown view adds the scroll container's `scrollTop` /
 *   `scrollLeft` to client coordinates.
 *
 * `subscribe` lets the overlay re-render when the transform changes
 * (pan, zoom, scroll). It returns an unsubscribe function.
 */
export interface CoordTransform {
  toContent(clientX: number, clientY: number): { x: number; y: number } | null;
  toScreen(x: number, y: number): { left: number; top: number } | null;
  subscribe(cb: () => void): () => void;
}

/**
 * The single seam between the overlay package and any persistence
 * mechanism. The overlay never imports any specific persistence layer;
 * it talks to a backend that implements this interface.
 *
 * Reactivity contract: `readStrokes` / `readOtherCursors` MUST return a
 * referentially stable snapshot between subscriber notifications.
 * `useSyncExternalStore` (used by the hooks in this package) relies on
 * snapshot identity to decide whether to re-render. A backend that
 * returns a fresh array on every call will cause infinite re-renders.
 */
export interface AnnotationsBackend {
  /**
   * Return all strokes for the given scope. The returned reference must
   * remain stable until the next subscriber notification for this
   * scope.
   */
  readStrokes(scope: StrokeScope): readonly StrokeData[];

  /**
   * Subscribe to stroke changes for the given scope. The callback fires
   * after the underlying data has changed; the next `readStrokes` call
   * is expected to return a new reference reflecting the new state.
   */
  subscribeStrokes(scope: StrokeScope, cb: () => void): () => void;

  /**
   * Append a single completed stroke. Resolves once the write is
   * locally durable (the network sync may continue in the background).
   */
  appendStroke(stroke: StrokeData): Promise<void>;

  /**
   * Remove every stroke in the given scope. Resolves once the splice is
   * locally durable.
   */
  clearStrokes(scope: StrokeScope): Promise<void>;

  /**
   * Delete a single stroke by its globally-unique id. Scope-agnostic
   * because ids are unique across views and files; a no-op if the id is
   * unknown.
   */
  deleteStroke(strokeId: string): Promise<void>;

  /**
   * Write the local user's latest cursor tick. Throttling is applied by
   * the consumer (see `useCursors`); the backend writes whatever it is
   * given.
   */
  writeCursorTick(tick: CursorTick): void;

  /**
   * Return the most recent tick for every other viewer in the scope.
   * The own user's ticks must be excluded. Returned reference must
   * remain stable until the next subscriber notification.
   */
  readOtherCursors(scope: StrokeScope): readonly CursorTick[];

  /** Subscribe to cursor changes for the given scope. */
  subscribeCursors(scope: StrokeScope, cb: () => void): () => void;
}
