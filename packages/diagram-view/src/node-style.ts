import type { NodeStyle } from "./types";
import { isSvgShape } from "./shapes";

/**
 * Type guard: returns true when the value is a non-null object that could
 * be a NodeStyle. All NodeStyle fields are optional, so any plain object
 * qualifies — this is sufficient to avoid an unsafe cast while preserving
 * the public NodeStyle type downstream.
 */
export function isNodeStyle(value: unknown): value is NodeStyle {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build the final React Flow `style` for a node by converting
 * the NodeStyle spec into CSS properties. Since NodeStyle already uses
 * CSS property names, this is a direct pass-through of defined fields.
 *
 * For SVG shapes (cylinder, diamond, circle, hexagon) background, border,
 * and boxShadow are suppressed here because the SVG element inside
 * DefaultNode draws them. Without this, the React Flow wrapper div
 * (which sits outside DefaultNode) would show a rectangular background
 * behind the non-rectangular shape.
 */
export function buildNodeStyle(
  s: NodeStyle | undefined,
): Record<string, string | number> | undefined {
  if (!s) return undefined;
  const svgShape = isSvgShape(s.shape);
  const css: Record<string, string | number> = {};
  if (s.background && !svgShape) css.background = s.background;
  if (s.borderColor && !svgShape) css.borderColor = s.borderColor;
  if (s.borderWidth !== undefined && !svgShape) css.borderWidth = s.borderWidth;
  if (s.opacity !== undefined) css.opacity = s.opacity;
  if (s.boxShadow && !svgShape) css.boxShadow = s.boxShadow;
  return Object.keys(css).length > 0 ? css : undefined;
}
