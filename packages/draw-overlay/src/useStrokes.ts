import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AnnotationsBackend, StrokeData, StrokeScope } from "./types";

/**
 * Subscribe to the strokes for a single scope and obtain callbacks to
 * append a new stroke or clear the scope.
 *
 * Why this hook exists: the overlay component needs a React-friendly
 * (snapshot-stable, re-render on change) view of `backend.readStrokes`
 * without taking a dependency on any specific persistence layer. This
 * hook is the only place in the package that calls
 * `useSyncExternalStore` for strokes.
 *
 * Snapshot stability is the backend's responsibility: see
 * `AnnotationsBackend.readStrokes` JSDoc.
 *
 * @param backend Pluggable annotations backend (in tests an in-memory
 *   stub; in production the application's persistence adapter).
 * @param scope `{ view, filePath? }` — the surface to observe.
 * @returns
 *   - `strokes`: latest snapshot of strokes for the scope.
 *   - `append(stroke)`: forward to `backend.appendStroke`.
 *   - `erase(strokeId)`: forward to `backend.deleteStroke`. Scope-agnostic
 *     because stroke ids are globally unique; lets the eraser tool delete
 *     a stroke regardless of which (view, filePath) bucket it lives in.
 *   - `clearAll()`: forward to `backend.clearStrokes` with the current
 *     scope already bound.
 */
export function useStrokes(
  backend: AnnotationsBackend,
  scope: StrokeScope,
): {
  strokes: readonly StrokeData[];
  append: (stroke: StrokeData) => Promise<void>;
  erase: (strokeId: string) => Promise<void>;
  clearAll: () => Promise<void>;
} {
  // Memoise the scope identity so subscribe/getSnapshot don't churn
  // every render. A change in `view` or `filePath` re-binds; otherwise
  // the same object is reused. Without this, `useSyncExternalStore`
  // would resubscribe every render.
  const stableScope = useMemo<StrokeScope>(
    () => ({ view: scope.view, filePath: scope.filePath }),
    [scope.view, scope.filePath],
  );

  const subscribe = useCallback(
    (cb: () => void) => backend.subscribeStrokes(stableScope, cb),
    [backend, stableScope],
  );

  const getSnapshot = useCallback(
    () => backend.readStrokes(stableScope),
    [backend, stableScope],
  );

  const strokes = useSyncExternalStore(subscribe, getSnapshot);

  const append = useCallback(
    (stroke: StrokeData) => backend.appendStroke(stroke),
    [backend],
  );

  const erase = useCallback(
    (strokeId: string) => backend.deleteStroke(strokeId),
    [backend],
  );

  const clearAll = useCallback(
    () => backend.clearStrokes(stableScope),
    [backend, stableScope],
  );

  return { strokes, append, erase, clearAll };
}
