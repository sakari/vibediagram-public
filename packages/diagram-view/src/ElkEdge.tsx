import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import type { Point } from "./types";

/**
 * Edge label rendered in the HTML layer via EdgeLabelRenderer.
 * This avoids SVG foreignObject, which causes DOM churn when edges
 * re-render rapidly during simulation.
 */
function EdgeLabel({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <EdgeLabelRenderer>
      <div
        className="elk-edge-label"
        style={{
          position: "absolute",
          transform: `translate(-50%, -50%) translate(${String(x)}px,${String(y)}px)`,
          fontSize: 11,
          color: "#9090a0",
          pointerEvents: "none",
        }}
      >
        {label}
      </div>
    </EdgeLabelRenderer>
  );
}

function isPoint(p: unknown): p is Point {
  if (typeof p !== "object" || p === null) return false;
  return (
    "x" in p && "y" in p && typeof p.x === "number" && typeof p.y === "number"
  );
}

function isBendPoints(value: unknown): value is Point[] {
  return Array.isArray(value) && value.length >= 2 && value.every(isPoint);
}

/**
 * Build an SVG path from ELK bend points (startPoint, bends..., endPoint).
 * Draws orthogonal line segments that follow ELK's computed routing,
 * which avoids crossing through nodes.
 */
function bendPointsToPath(points: Point[]): string {
  const parts = [`M ${String(points[0].x)},${String(points[0].y)}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${String(points[i].x)},${String(points[i].y)}`);
  }
  return parts.join(" ");
}

/** Compute the midpoint of a bend-point path for label placement. */
function bendPointsMidpoint(points: Point[]): { x: number; y: number } {
  // Walk segments, find the point at half the total path length
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }
  let half = totalLen / 2;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (half <= segLen) {
      const t = segLen > 0 ? half / segLen : 0;
      return {
        x: points[i - 1].x + dx * t,
        y: points[i - 1].y + dy * t,
      };
    }
    half -= segLen;
  }
  return points[Math.floor(points.length / 2)];
}

/**
 * Custom React Flow edge component that renders paths using ELK's
 * computed bend points when available, falling back to getSmoothStepPath.
 *
 * Using ELK bend points ensures edges route around nodes instead of
 * cutting through them, and gives each edge a distinct path so
 * overlapping edges are separated.
 *
 * Labels are rendered in the HTML layer (via EdgeLabelRenderer) rather
 * than SVG foreignObject to prevent flickering during rapid updates.
 */
export const ElkEdge = React.memo(function ElkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  data,
}: EdgeProps) {
  const bendPoints =
    data != null && isBendPoints(data.bendPoints) ? data.bendPoints : null;

  let path: string;
  let labelX: number;
  let labelY: number;

  if (bendPoints) {
    path = bendPointsToPath(bendPoints);
    const mid = bendPointsMidpoint(bendPoints);
    labelX = mid.x;
    labelY = mid.y;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
  }

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label && typeof label === "string" && (
        <EdgeLabel x={labelX} y={labelY} label={label} />
      )}
    </>
  );
});
