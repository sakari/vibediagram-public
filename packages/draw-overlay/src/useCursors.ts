import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AnnotationsBackend, CursorTick, StrokeScope } from "./types";

/**
 * Minimum interval between outbound cursor ticks (milliseconds).
 *
 * Justification: matches the cursor write budget agreed in the plan
 * ("≤ 20 ticks/sec/user"). Any pointer-move sampled inside this window
 * is dropped on the floor.
 */
const TICK_THROTTLE_MS = 50;

/**
 * Time after which a remote cursor tick is considered stale and hidden
 * from `otherCursors` (milliseconds).
 *
 * The CoFeed transport has no built-in TTL, so the staleness check has
 * to live on the read side.
 */
const STALE_AFTER_MS = 2000;

/**
 * How often `useCursors` forces a re-render while idle so that stale
 * remote ticks disappear without needing a backend notification.
 */
const STALE_SWEEP_MS = 500;

/**
 * Subscribe to remote cursor ticks for a single scope and obtain a
 * throttled writer for the local user's own tick.
 *
 * Why this hook exists: the overlay component needs to publish the
 * local pointer position at a bounded rate AND read other viewers'
 * positions, both without any direct knowledge of the backend
 * implementation.
 *
 * Behaviour:
 * - `writeTick` enforces a {@link TICK_THROTTLE_MS}ms minimum gap
 *   between outbound ticks; calls inside the window are silently
 *   dropped. Each accepted call assembles a full `CursorTick`
 *   (filling `view`, `filePath`, `name`, `t`) and forwards it to
 *   `backend.writeCursorTick`.
 * - `otherCursors` returns the latest remote ticks for the scope with
 *   stale entries (`Date.now() - tick.t > STALE_AFTER_MS`) filtered
 *   out. A periodic re-render ensures stale ticks disappear even when
 *   no backend notification fires.
 *
 * @param backend Pluggable annotations backend.
 * @param scope `{ view, filePath? }` — the surface to observe / write.
 * @param ownIdentity Display name for the local user; baked into every
 *   outbound `CursorTick.name`.
 */
export function useCursors(
  backend: AnnotationsBackend,
  scope: StrokeScope,
  ownIdentity: { name: string },
): {
  writeTick: (partial: Pick<CursorTick, "x" | "y" | "drawing">) => void;
  otherCursors: readonly CursorTick[];
} {
  // Stable scope identity, mirroring the rationale in `useStrokes`:
  // without this the underlying `useSyncExternalStore` would resubscribe
  // every render.
  const stableScope = useMemo<StrokeScope>(
    () => ({ view: scope.view, filePath: scope.filePath }),
    [scope.view, scope.filePath],
  );

  const subscribe = useCallback(
    (cb: () => void) => backend.subscribeCursors(stableScope, cb),
    [backend, stableScope],
  );

  const getSnapshot = useCallback(
    () => backend.readOtherCursors(stableScope),
    [backend, stableScope],
  );

  const allOtherCursors = useSyncExternalStore(subscribe, getSnapshot);

  // Periodic re-render so the staleness filter below catches up with
  // wall-clock time even when no remote tick arrives. We use a state
  // counter rather than calling `forceUpdate` so React stays happy in
  // strict mode. The counter is also a memo dependency so the filter
  // re-runs each sweep — without it the cached array would survive
  // ageing past the cutoff between backend notifications.
  const [sweepTick, setSweepTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => {
      setSweepTick((n) => n + 1);
    }, STALE_SWEEP_MS);
    return () => {
      clearInterval(handle);
    };
  }, []);

  const otherCursors = useMemo(() => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    return allOtherCursors.filter((tick) => tick.t >= cutoff);
    // sweepTick is intentional: forces re-filter as wall clock advances.
  }, [allOtherCursors, sweepTick]);

  // Track the last accepted write timestamp in a ref so consecutive
  // calls inside the throttle window are dropped without triggering a
  // re-render or breaking React's batching.
  const lastWriteAtRef = useRef(0);
  const ownNameRef = useRef(ownIdentity.name);
  // Keep the ref in sync without resubscribing the writer callback.
  useEffect(() => {
    ownNameRef.current = ownIdentity.name;
  }, [ownIdentity.name]);

  const writeTick = useCallback(
    (partial: Pick<CursorTick, "x" | "y" | "drawing">) => {
      const now = Date.now();
      if (now - lastWriteAtRef.current < TICK_THROTTLE_MS) {
        return;
      }
      lastWriteAtRef.current = now;
      const tick: CursorTick = {
        view: stableScope.view,
        filePath: stableScope.filePath,
        x: partial.x,
        y: partial.y,
        drawing: partial.drawing,
        name: ownNameRef.current,
        t: now,
      };
      backend.writeCursorTick(tick);
    },
    [backend, stableScope],
  );

  return { writeTick, otherCursors };
}
