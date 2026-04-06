/**
 * SVG shape renderers for non-rectangular diagram nodes.
 *
 * Each shape is drawn inside a `viewBox="0 0 100 100"` SVG that stretches
 * to fill the node container via `preserveAspectRatio="none"`.
 * Strokes use `vectorEffect="non-scaling-stroke"` so line widths stay
 * crisp regardless of the node's aspect ratio.
 */
import type { NodeShape } from "./types";

/** Returns true when the shape requires an SVG overlay instead of CSS-only styling. */
export function isSvgShape(shape: NodeShape | undefined): boolean {
  return (
    shape === "cylinder" ||
    shape === "diamond" ||
    shape === "circle" ||
    shape === "hexagon"
  );
}

const VE = "non-scaling-stroke" as const;

function cylinderShape(
  fill: string,
  stroke: string,
  sw: number,
): React.ReactElement {
  // Cylinder: body rect + two elliptical caps.
  // The top ellipse is drawn last so it covers the rect's top edge.
  const ry = 12;
  return (
    <>
      <rect
        x={0}
        y={ry}
        width={100}
        height={100 - 2 * ry}
        fill={fill}
        stroke="none"
      />
      <line
        x1={0}
        y1={ry}
        x2={0}
        y2={100 - ry}
        stroke={stroke}
        strokeWidth={sw}
        vectorEffect={VE}
      />
      <line
        x1={100}
        y1={ry}
        x2={100}
        y2={100 - ry}
        stroke={stroke}
        strokeWidth={sw}
        vectorEffect={VE}
      />
      <ellipse
        cx={50}
        cy={100 - ry}
        rx={50}
        ry={ry}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        vectorEffect={VE}
      />
      <ellipse
        cx={50}
        cy={ry}
        rx={50}
        ry={ry}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        vectorEffect={VE}
      />
    </>
  );
}

function diamondShape(
  fill: string,
  stroke: string,
  sw: number,
): React.ReactElement {
  return (
    <polygon
      points="50,0 100,50 50,100 0,50"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      vectorEffect={VE}
    />
  );
}

function circleShape(
  fill: string,
  stroke: string,
  sw: number,
): React.ReactElement {
  return (
    <ellipse
      cx={50}
      cy={50}
      rx={50}
      ry={50}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      vectorEffect={VE}
    />
  );
}

function hexagonShape(
  fill: string,
  stroke: string,
  sw: number,
): React.ReactElement {
  // Flat-top hexagon with ~20% indentation on left/right sides.
  const indent = 20;
  const right = String(100 - indent);
  const points = `${String(indent)},0 ${right},0 100,50 ${right},100 ${String(indent)},100 0,50`;
  return (
    <polygon
      points={points}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      vectorEffect={VE}
    />
  );
}

/**
 * Render an absolutely-positioned SVG shape that fills the node container.
 * Only call this for shapes where `isSvgShape` returns true.
 */
export function renderShape(
  shape: NodeShape,
  fill: string,
  stroke: string,
  strokeWidth: number,
): React.ReactElement {
  let children: React.ReactNode;

  switch (shape) {
    case "cylinder":
      children = cylinderShape(fill, stroke, strokeWidth);
      break;
    case "diamond":
      children = diamondShape(fill, stroke, strokeWidth);
      break;
    case "circle":
      children = circleShape(fill, stroke, strokeWidth);
      break;
    case "hexagon":
      children = hexagonShape(fill, stroke, strokeWidth);
      break;
    default:
      // rectangle and rounded-rectangle are CSS-only
      children = null;
  }

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
      }}
    >
      {children}
    </svg>
  );
}
