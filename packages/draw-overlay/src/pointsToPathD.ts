import type { CoordTransform, Point } from "./types";

/**
 * Build the SVG `<path d="...">` string for a polyline of content-space
 * points, mapping each through the supplied {@link CoordTransform} into
 * screen coordinates.
 *
 * Why this exists as its own module:
 * - It is shared by both the cold-paint code path (rendering committed
 *   strokes) and the hot path (mutating the in-progress stroke's `d`
 *   imperatively in a `requestAnimationFrame` flush). Keeping the format
 *   in one place guarantees both paths produce identical strings.
 * - It allows targeted unit + benchmark tests of the hottest piece of
 *   per-frame work without spinning up a React render.
 *
 * Behaviour:
 * - Returns the empty string when `points` is empty or no point projects
 *   onto the screen (this signals "render nothing"; the caller decides
 *   whether to skip the `<path>` element entirely).
 * - Skips individual points where `transform.toScreen` returns `null` —
 *   the stroke continues straight from the last visible point to the
 *   next, which matches user intent (transient off-canvas excursions
 *   should not break the stroke).
 *
 * The output uses `M x y` for the first projected point and `L x y` for
 * the rest. Coordinates are emitted with `toString()` (no rounding) so
 * the renderer keeps subpixel fidelity; SVG handles the rasterisation.
 */
export function pointsToPathD(
  points: readonly Point[],
  transform: CoordTransform,
): string {
  if (points.length === 0) return "";
  // Build via array join rather than string concatenation: V8 handles
  // large joins efficiently, and the bench in `DrawOverlay.bench.ts`
  // exercises this path.
  const parts: string[] = [];
  for (const [x, y] of points) {
    const screen = transform.toScreen(x, y);
    if (screen === null) continue;
    const command = parts.length === 0 ? "M" : "L";
    parts.push(`${command} ${String(screen.left)} ${String(screen.top)}`);
  }
  return parts.join(" ");
}
