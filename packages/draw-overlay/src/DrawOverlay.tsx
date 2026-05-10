import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "./draw-overlay.css";
import type {
  AnnotationsBackend,
  CoordTransform,
  Point,
  StrokeData,
  StrokeScope,
  StrokeView,
} from "./types";
import { useStrokes } from "./useStrokes";
import { useCursors } from "./useCursors";
import { pointsToPathD } from "./pointsToPathD";

/**
 * Props for the freehand drawing overlay.
 *
 * The overlay is mode-agnostic: any view (diagram, markdown, future) can
 * mount it by supplying a {@link CoordTransform} that maps DOM client
 * coordinates to the view's content coordinate space. The {@link AnnotationsBackend}
 * is the only persistence seam — the component never imports any storage
 * implementation directly.
 *
 * The parent container MUST be `position: relative` so the absolutely
 * positioned `<svg>` anchors correctly.
 */
export interface DrawOverlayProps {
  /**
   * When `false`, the component renders **nothing at all** — no `<svg>`,
   * no wrapper `<div>`. The consumer uses this to suppress the overlay
   * before the persistence backend is ready (e.g. a reader on a project
   * a writer has not yet bootstrapped).
   *
   * The everyday visibility-vs-passive distinction is made by `tool`:
   * `"hand"` keeps strokes visible but lets pointer events pass through
   * (so pan/zoom/scroll still work).
   */
  enabled: boolean;
  /** Which view this overlay belongs to. */
  mode: StrokeView;
  /** Required for `mode === "markdown"`; omitted for `"diagram"`. */
  filePath?: string;
  /** Coordinate transform supplied by the host view (pan/zoom/scroll-aware). */
  transform: CoordTransform;
  /** Persistence backend (in-memory in tests, CRDT adapter in production). */
  backend: AnnotationsBackend;
  /** Pen color for new strokes drawn locally. */
  color: string;
  /** Pen width for new strokes drawn locally. */
  width: number;
  /** Stable identifier for the local user; written into every new stroke. */
  authorId: string;
  /** Display name for the local user; written into outbound cursor ticks. */
  authorName: string;
  /**
   * Active drawing tool. Defaults to `"hand"` — strokes are visible but
   * the SVG passes pointer events through so pan/zoom/scroll work as
   * usual.
   *
   * - `"hand"`: SVG `pointer-events: none`; strokes still rendered.
   *   No drawing, no cursor ticks emitted.
   * - `"pen"`: SVG `pointer-events: auto`; primary-button drag draws a
   *   stroke and persists it on `pointerup`.
   * - `"eraser"`: SVG `pointer-events: none` on the background, but each
   *   persisted `<path>` opts back in (`pointer-events: stroke`) so a
   *   click on a stroke deletes it via `backend.deleteStroke`. Pan and
   *   zoom on empty space still work.
   */
  tool?: "hand" | "pen" | "eraser";
}

/**
 * Internal: hash a string to a stable hue (0-359) so each remote viewer
 * gets a distinguishable cursor color without needing an explicit palette
 * coordination step.
 */
function hueFromString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  // Force into 0..359 regardless of sign.
  return ((h % 360) + 360) % 360;
}

const cursorColorFor = (name: string): string =>
  `hsl(${String(hueFromString(name))}, 70%, 55%)`;

/**
 * Freehand drawing overlay.
 *
 * Behaviour summary (full spec in {@link DrawOverlayProps} and the plan):
 * - Renders nothing when `enabled === false`.
 * - Subscribes to `transform.subscribe` so panning / zooming / scrolling
 *   the host view triggers a re-render of the painted strokes.
 * - Captures the pointer on `pointerdown` so the in-progress stroke
 *   continues even when the cursor moves outside the SVG bounding box.
 * - Mutates the in-progress `<path>`'s `d` attribute imperatively (no
 *   React re-render per move) — this is the perf strategy validated by
 *   Spike 2.
 * - Emits cursor ticks while the pointer is inside the overlay; stops on
 *   `pointerleave`. The {@link useCursors} hook handles the ≥ 50 ms
 *   throttle.
 */
export function DrawOverlay(props: DrawOverlayProps) {
  if (!props.enabled) {
    // Hard early return BEFORE any hooks: when disabled we render zero
    // DOM. React requires hooks to be called unconditionally, so all
    // hooks live in the inner component below.
    return null;
  }
  return <DrawOverlayActive {...props} />;
}

function DrawOverlayActive({
  mode,
  filePath,
  transform,
  backend,
  color,
  width,
  authorId,
  authorName,
  // The default is "pen" because every consumer that uses this component
  // through `DrawingToolbar` already supplies an explicit `tool`; the
  // default exists for the smaller test-shaped call sites that just want
  // basic drawing behaviour. Hand mode is what the workspace actively
  // selects on first mount.
  tool = "pen",
}: DrawOverlayProps) {
  const scope: StrokeScope = { view: mode, filePath };
  const { strokes, append, erase } = useStrokes(backend, scope);
  const { writeTick, otherCursors } = useCursors(backend, scope, {
    name: authorName,
  });

  // Force a re-render whenever the host view's transform changes (pan,
  // zoom, scroll). We use a counter rather than `useState({})` so React's
  // bail-out logic doesn't accidentally skip a render.
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubscribe = transform.subscribe(forceUpdate);
    return unsubscribe;
  }, [transform]);

  // In-progress stroke buffer. Lives in a ref so high-frequency
  // pointermove handling doesn't trigger React renders.
  const inProgressPointsRef = useRef<Point[] | null>(null);
  const liveStrokeColorRef = useRef(color);
  const liveStrokeWidthRef = useRef(width);
  const liveStrokeAuthorIdRef = useRef(authorId);
  // Snapshot the live stroke's pen settings + author at pointerdown so a
  // mid-stroke change in props doesn't re-color the in-progress path.
  const livePathRef = useRef<SVGPathElement | null>(null);

  // RAF coalescing: store the latest screen point received from
  // pointermove and flush it in a single RAF callback. This caps
  // path-mutation work to ~60 Hz regardless of pointer rate.
  const pendingScreenPointRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const rafHandleRef = useRef<number | null>(null);

  // Helper: rebuild the live <path>'s `d` from the in-progress points
  // and write it to the DOM imperatively. Skips points that fail
  // toScreen (off-canvas / not yet measurable).
  const repaintLivePath = useCallback(() => {
    const path = livePathRef.current;
    const points = inProgressPointsRef.current;
    if (!path || !points || points.length === 0) return;
    const d = pointsToPathD(points, transform);
    path.setAttribute("d", d);
  }, [transform]);

  const flushPendingPoint = useCallback(() => {
    rafHandleRef.current = null;
    const pending = pendingScreenPointRef.current;
    pendingScreenPointRef.current = null;
    const points = inProgressPointsRef.current;
    if (!pending || !points) return;
    const content = transform.toContent(pending.clientX, pending.clientY);
    if (content === null) return;
    points.push([content.x, content.y]);
    repaintLivePath();
    // Cursor tick is throttled by the hook itself.
    writeTick({ x: content.x, y: content.y, drawing: true });
  }, [transform, repaintLivePath, writeTick]);

  const scheduleFlush = useCallback(() => {
    if (rafHandleRef.current !== null) return;
    // jsdom does not implement requestAnimationFrame in older versions;
    // fall back to a microtask so tests can still drive the flush. In
    // production environments rAF is always available.
    if (typeof requestAnimationFrame === "function") {
      rafHandleRef.current = requestAnimationFrame(flushPendingPoint);
    } else {
      rafHandleRef.current = 1;
      queueMicrotask(flushPendingPoint);
    }
  }, [flushPendingPoint]);

  const cancelPendingFlush = useCallback(() => {
    if (
      rafHandleRef.current !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(rafHandleRef.current);
    }
    rafHandleRef.current = null;
    pendingScreenPointRef.current = null;
  }, []);

  // Cleanup on unmount: cancel any pending RAF.
  useEffect(() => {
    return () => {
      cancelPendingFlush();
    };
  }, [cancelPendingFlush]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      // Only react to primary buttons (left mouse, primary stylus, single
      // finger). Secondary pointers must not start a stroke.
      if (e.button !== 0) return;
      // Hand and eraser modes: pen-down on the SVG background is a no-op.
      // (Eraser deletion is handled by the per-stroke pointerdown handler
      // attached on each persisted <path> below.) Hand mode shouldn't even
      // reach this handler because the SVG has `pointer-events: none`, but
      // we keep the guard for defence-in-depth and tests.
      if (tool !== "pen") return;
      // Capture so events keep flowing even when the pointer leaves the
      // SVG bounds — verified by Spike 2 §A.
      e.currentTarget.setPointerCapture(e.pointerId);
      const content = transform.toContent(e.clientX, e.clientY);
      if (content === null) return;
      inProgressPointsRef.current = [[content.x, content.y]];
      liveStrokeColorRef.current = color;
      liveStrokeWidthRef.current = width;
      liveStrokeAuthorIdRef.current = authorId;
      // Repaint synchronously so the stroke's first dot appears on press
      // even before the next pointermove.
      repaintLivePath();
      writeTick({ x: content.x, y: content.y, drawing: true });
    },
    [tool, transform, color, width, authorId, repaintLivePath, writeTick],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (inProgressPointsRef.current !== null) {
        // Mid-stroke: coalesce to RAF cadence.
        pendingScreenPointRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
        };
        scheduleFlush();
        return;
      }
      // Hand mode never emits cursor ticks (the SVG also has
      // pointer-events: none, so we should rarely reach here anyway).
      if (tool === "hand") return;
      // No stroke in progress, but the pointer is hovering over the
      // overlay — emit a non-drawing tick so other viewers see our cursor.
      const content = transform.toContent(e.clientX, e.clientY);
      if (content === null) return;
      writeTick({ x: content.x, y: content.y, drawing: false });
    },
    [tool, transform, scheduleFlush, writeTick],
  );

  const finishStroke = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const points = inProgressPointsRef.current;
      // Always release capture, even on a no-op finish, so we don't leak
      // capture on a degenerate gesture.
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // releasePointerCapture throws if the pointer was never
        // captured. Safe to swallow — the only side effect we care about
        // is the capture being gone, which it is by definition here.
      }
      cancelPendingFlush();
      inProgressPointsRef.current = null;
      const path = livePathRef.current;
      if (path) {
        // Hide the live path until the next stroke starts. Setting an
        // empty `d` is the cheapest reset; the element stays mounted.
        path.setAttribute("d", "");
      }
      if (!points || points.length === 0) return;
      const stroke: StrokeData = {
        id: crypto.randomUUID(),
        view: mode,
        filePath,
        points,
        color: liveStrokeColorRef.current,
        width: liveStrokeWidthRef.current,
        authorId: liveStrokeAuthorIdRef.current,
        createdAt: Date.now(),
      };
      // Fire-and-forget: append is async but the visual confirmation
      // comes from the next render reading the stroke back from the
      // backend. We intentionally do not block the gesture.
      void append(stroke);
      // Final cursor tick — drawing stopped. `points.length > 0` by the
      // early return above, so the last element is always defined and
      // TypeScript narrows it without an explicit assertion.
      const last = points[points.length - 1];
      writeTick({ x: last[0], y: last[1], drawing: false });
    },
    [mode, filePath, append, writeTick, cancelPendingFlush],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      finishStroke(e);
    },
    [finishStroke],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      finishStroke(e);
    },
    [finishStroke],
  );

  const onPointerLeave = useCallback(() => {
    // We do NOT cancel an in-progress stroke here: the active pointer
    // capture keeps events flowing to onPointerMove until pointerup.
    // The only thing pointerleave changes is that we stop emitting
    // hover ticks; the most recent tick will age out client-side via
    // the staleness filter in useCursors.
  }, []);

  // Eraser-mode hit handler: removes the stroke whose path was clicked.
  // The handler is only attached when `tool === "eraser"` so we don't
  // re-check it here. We stop propagation so the synthetic event doesn't
  // bubble to the <svg>'s own onPointerDown (a no-op in eraser mode, but
  // a clean event flow makes the test surface easier to reason about),
  // and prevent default so the parent SVG's native pointerdown listener —
  // if any — doesn't double-fire.
  const onEraseStroke = useCallback(
    (strokeId: string, e: ReactPointerEvent<SVGPathElement>) => {
      // Ignore secondary buttons so right-click / middle-click on a stroke
      // doesn't accidentally erase it.
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      void erase(strokeId);
    },
    [erase],
  );

  return (
    <svg
      className={`draw-overlay draw-overlay-${tool}`}
      data-testid="draw-overlay-svg"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
    >
      {strokes.map((stroke) => {
        const d = pointsToPathD(stroke.points, transform);
        if (d.length === 0) return null;
        const isEraser = tool === "eraser";
        return (
          <path
            key={stroke.id}
            className={
              isEraser
                ? "draw-overlay-stroke draw-overlay-stroke-erasable"
                : "draw-overlay-stroke"
            }
            data-testid="draw-overlay-stroke-path"
            data-stroke-id={stroke.id}
            d={d}
            stroke={stroke.color}
            strokeWidth={stroke.width}
            onPointerDown={
              isEraser
                ? (e): void => {
                    onEraseStroke(stroke.id, e);
                  }
                : undefined
            }
          />
        );
      })}
      {/* In-progress live path: mounted once, mutated imperatively. The
          empty default `d` keeps it invisible until pointerdown. */}
      <path
        ref={livePathRef}
        className="draw-overlay-stroke"
        data-testid="draw-overlay-live-path"
        d=""
        stroke={color}
        strokeWidth={width}
      />
      {otherCursors.map((tick) => {
        const screen = transform.toScreen(tick.x, tick.y);
        if (!screen) return null;
        const dotColor = cursorColorFor(tick.name);
        return (
          <g
            key={tick.name}
            className="draw-overlay-cursor"
            transform={`translate(${String(screen.left)}, ${String(screen.top)})`}
          >
            <circle className="draw-overlay-cursor-dot" r={3} fill={dotColor} />
            <text className="draw-overlay-cursor-label" x={8} y={4}>
              {tick.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
