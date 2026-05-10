import { describe, it, expect } from "vitest";
import { pointsToPathD } from "./pointsToPathD";
import type { CoordTransform, Point } from "./types";

const identity: CoordTransform = {
  toContent: (cx, cy) => ({ x: cx, y: cy }),
  toScreen: (x, y) => ({ left: x, top: y }),
  subscribe: () => () => {},
};

const rejectAll: CoordTransform = {
  toContent: () => null,
  toScreen: () => null,
  subscribe: () => () => {},
};

describe("pointsToPathD", () => {
  it("[ptp-empty] returns the empty string for an empty points array", () => {
    expect(pointsToPathD([], identity)).toBe("");
  });

  it("[ptp-all-rejected] returns the empty string when no point projects to screen", () => {
    const points: Point[] = [
      [1, 2],
      [3, 4],
    ];
    expect(pointsToPathD(points, rejectAll)).toBe("");
  });

  it("[ptp-shape] emits a single M followed by L for each subsequent visible point", () => {
    const points: Point[] = [
      [0, 0],
      [10, 20],
      [30, 40],
    ];
    expect(pointsToPathD(points, identity)).toBe("M 0 0 L 10 20 L 30 40");
  });

  it("[ptp-skip-rejected] skips individual rejected points and starts with M at the first visible one", () => {
    const points: Point[] = [
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    // Reject the first point only.
    let calls = 0;
    const transform: CoordTransform = {
      toContent: () => null,
      toScreen: (x, y) => {
        calls += 1;
        return calls === 1 ? null : { left: x, top: y };
      },
      subscribe: () => () => {},
    };
    expect(pointsToPathD(points, transform)).toBe("M 2 2 L 3 3");
  });
});
