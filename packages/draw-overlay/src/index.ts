/**
 * Public entry point for `@diagram/draw-overlay`.
 *
 * The package exposes a small backend-agnostic surface:
 * - {@link AnnotationsBackend} — the contract every persistence adapter
 *   (in-memory, CRDT, future) must satisfy.
 * - {@link useStrokes} / {@link useCursors} — thin React hooks that wrap
 *   that contract for use by the SVG overlay.
 * - {@link DrawOverlay} — the freehand drawing SVG component the host
 *   view (diagram, markdown, future) mounts inside its own pane.
 */
export { DrawOverlay } from "./DrawOverlay";
export type { DrawOverlayProps } from "./DrawOverlay";
export { useStrokes } from "./useStrokes";
export { useCursors } from "./useCursors";
export type {
  AnnotationsBackend,
  CoordTransform,
  CursorTick,
  Point,
  StrokeData,
  StrokeScope,
  StrokeView,
} from "./types";
