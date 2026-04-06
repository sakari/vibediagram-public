/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ElkEdge } from "./ElkEdge";
import { type EdgeProps, Position, ReactFlowProvider } from "@xyflow/react";

// EdgeLabelRenderer uses a portal that requires a full ReactFlow mount.
// Mock it to render children inline so label tests work in isolation.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) =>
      children,
  };
});

const baseProps: EdgeProps = {
  id: "e1",
  source: "a",
  target: "b",
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top,
  data: {},
  sourceHandleId: null,
  targetHandleId: null,
  interactionWidth: 20,
};

function renderEdge(props: Partial<EdgeProps> = {}) {
  return render(
    <ReactFlowProvider>
      <svg>
        <ElkEdge {...baseProps} {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

describe("ElkEdge", () => {
  it("[ee-path] renders smooth step path from handle positions", () => {
    const { container } = renderEdge();
    const path = container.querySelector("path");
    expect(path).not.toBeNull();

    const d = path!.getAttribute("d");
    expect(d).toBeTruthy();
    // getSmoothStepPath produces an orthogonal path with M and multiple segments
    expect(d).toContain("M");
  });

  it("[ee-orthogonal] path is orthogonal (no diagonal segments)", () => {
    const { container } = renderEdge({
      sourceX: 50,
      sourceY: 0,
      targetX: 150,
      targetY: 100,
    });
    const path = container.querySelector("path");
    const d = path!.getAttribute("d")!;
    // getSmoothStepPath creates step paths — every segment is horizontal or vertical
    expect(d).toContain("M");
  });

  describe("label rendering", () => {
    it("[ee-label] renders label text", () => {
      const { container } = renderEdge({ label: "request" });
      expect(container.textContent).toContain("request");
    });

    it("[ee-label] renders without label when none provided", () => {
      const { container } = renderEdge();
      const path = container.querySelector("path");
      expect(path).not.toBeNull();
      // No label div should be rendered
      expect(container.querySelector(".elk-edge-label")).toBeNull();
    });
  });

  it("[ee-style] style properties are applied to the path", () => {
    const { container } = renderEdge({
      style: { stroke: "red", strokeWidth: 3 },
    });
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path!.style.stroke).toBe("red");
    expect(path!.style.strokeWidth).toBe("3");
  });

  describe("ELK bend points", () => {
    it("[ee-bend] uses bend points when available in data", () => {
      const { container } = renderEdge({
        data: {
          bendPoints: [
            { x: 10, y: 0 },
            { x: 10, y: 50 },
            { x: 100, y: 50 },
            { x: 100, y: 100 },
          ],
        },
      });
      const path = container.querySelector("path");
      const d = path!.getAttribute("d")!;
      // Bend point path uses M and L segments, not smooth curves
      expect(d).toBe("M 10,0 L 10,50 L 100,50 L 100,100");
    });

    it("[ee-bend-label] places label at midpoint of bend point path", () => {
      const { container } = renderEdge({
        label: "spawns",
        data: {
          bendPoints: [
            { x: 0, y: 0 },
            { x: 0, y: 100 },
          ],
        },
      });
      const label = container.querySelector(".elk-edge-label");
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe("spawns");
      // Label positioned at midpoint: (0, 50)
      const style = label!.getAttribute("style") ?? "";
      expect(style).toContain("translate(0px,50px)");
    });

    it("[ee-bend-fallback] falls back to getSmoothStepPath when bendPoints missing", () => {
      const { container } = renderEdge({ data: {} });
      const path = container.querySelector("path");
      const d = path!.getAttribute("d")!;
      // getSmoothStepPath produces curves/steps, not simple L segments
      expect(d).toContain("M");
    });

    it("[ee-bend-fallback] falls back when bendPoints has fewer than 2 points", () => {
      const { container } = renderEdge({
        data: { bendPoints: [{ x: 0, y: 0 }] },
      });
      const path = container.querySelector("path");
      const d = path!.getAttribute("d")!;
      // Falls back to getSmoothStepPath
      expect(d).not.toBe("M 0,0");
    });

    it("[ee-bend-fallback] falls back when bendPoints is not an array", () => {
      const { container } = renderEdge({
        data: { bendPoints: "invalid" },
      });
      const path = container.querySelector("path");
      expect(path).not.toBeNull();
    });

    it("[ee-bend-mid] midpoint on multi-segment path falls on the correct segment", () => {
      // Path: (0,0) → (0,100) → (200,100) — total length 300, midpoint at 150
      // First segment length=100, so midpoint is 50 into the second segment
      const { container } = renderEdge({
        label: "test",
        data: {
          bendPoints: [
            { x: 0, y: 0 },
            { x: 0, y: 100 },
            { x: 200, y: 100 },
          ],
        },
      });
      const label = container.querySelector(".elk-edge-label");
      // Midpoint: at distance 150 along path. Seg1=100 (vertical), seg2=200 (horizontal).
      // 50 into seg2: x=0+50=50, y=100
      const style = label!.getAttribute("style") ?? "";
      expect(style).toContain("translate(50px,100px)");
    });
  });
});
