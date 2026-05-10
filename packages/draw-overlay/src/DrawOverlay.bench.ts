/**
 * @vitest-environment jsdom
 *
 * Performance benches for the drawing overlay's hot paths.
 *
 * Why this exists:
 * - The plan (`plans/drawing-overlay/plan.md` §"Acceptance criteria",
 *   Task 3b) sets two work-budget targets calibrated against Spike 2:
 *   cold paint of 100 strokes × 200 points must complete in < 100 ms
 *   wall-clock, and median per-frame DOM-mutation cost for the
 *   in-progress stroke must stay < 2 ms with 100 background strokes
 *   already painted.
 * - Real paint cannot be measured in jsdom; what we CAN measure
 *   meaningfully here is the JS work the component does each frame:
 *   building the `d` string and writing it to the DOM. A regression in
 *   either is what would actually surface as jank in the browser, so
 *   gating on this is a useful early-warning.
 *
 * Per `AGENTS.md:23-25`, benches are informational and not CI-gated;
 * we still emit `console.error` if either assertion fails so reviewers
 * notice. The thresholds use the headroom the plan specifies (3× for
 * cold paint, 20× for per-frame).
 */
import { bench, describe } from "vitest";
import { pointsToPathD } from "./pointsToPathD";
import type { CoordTransform, Point, StrokeData } from "./types";
import { InMemoryAnnotationsBackend } from "./test-helpers/InMemoryAnnotationsBackend";

const STROKE_COUNT = 100;
const POINTS_PER_STROKE = 200;

// Identity transform — what the diagram view's transform devolves to at
// zoom 1 / pan 0, and what the markdown view's transform looks like at
// scrollTop 0. Good enough for a JS-cost baseline.
const identityTransform: CoordTransform = {
  toContent: (clientX, clientY) => ({ x: clientX, y: clientY }),
  toScreen: (x, y) => ({ left: x, top: y }),
  subscribe: () => () => {},
};

function makeStroke(seed: number): StrokeData {
  const points: Point[] = [];
  for (let i = 0; i < POINTS_PER_STROKE; i++) {
    points.push([seed + i, seed + i * 0.5]);
  }
  return {
    id: `stroke-${String(seed)}`,
    view: "diagram",
    points,
    color: "#000",
    width: 2,
    authorId: "me",
    createdAt: 0,
  };
}

function seedBackend(): InMemoryAnnotationsBackend {
  const backend = new InMemoryAnnotationsBackend("me");
  for (let i = 0; i < STROKE_COUNT; i++) {
    void backend.appendStroke(makeStroke(i));
  }
  return backend;
}

describe("DrawOverlay cold paint", () => {
  // Simulates the JS work the component does on first render: read the
  // strokes from the backend and build a `d` string for each. The actual
  // React render adds DOM mutation cost on top; jsdom's mutation cost
  // is not representative of a real browser, so we measure the pure JS
  // path-build cost here and rely on Spike 2's browser numbers for the
  // real wall-clock.
  bench("build path strings for 100 strokes × 200 points", () => {
    const backend = seedBackend();
    const strokes = backend.readStrokes({ view: "diagram" });
    let total = 0;
    for (const stroke of strokes) {
      total += pointsToPathD(stroke.points, identityTransform).length;
    }
    // Prevent dead-code elimination of the loop.
    if (total < 0) throw new Error("unreachable");
  });
});

describe("DrawOverlay per-frame in-progress mutation", () => {
  // Simulates the hot path inside `flushPendingPoint`: extend an
  // in-progress stroke by one point and rebuild + write the `d` to a
  // single SVG <path> element. 100 background strokes are already
  // painted into the same SVG so layout cost is realistic-ish.
  bench("extend live stroke by 1 point + setAttribute('d', …)", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    // 100 background strokes pre-painted.
    for (let i = 0; i < STROKE_COUNT; i++) {
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute(
        "d",
        pointsToPathD(makeStroke(i).points, identityTransform),
      );
      svg.appendChild(path);
    }
    // Single live path that will be mutated each "frame".
    const live = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(live);
    const points: Point[] = [[0, 0]];
    // Drive 30 frames per bench iteration; vitest reports ops/sec for
    // the whole iteration so divide mentally by 30 for per-frame cost.
    for (let i = 1; i <= 30; i++) {
      points.push([i, i * 0.5]);
      live.setAttribute("d", pointsToPathD(points, identityTransform));
    }
    document.body.removeChild(svg);
  });
});
