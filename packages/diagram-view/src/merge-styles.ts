import type React from "react";
import type { Node, Edge } from "@xyflow/react";
import type { DiagramSpec, EdgeStyle } from "./types";
import { buildNodeStyle } from "./node-style";

function edgeStyleToCss(
  s: EdgeStyle | undefined,
): Record<string, string | number> | undefined {
  if (!s) return undefined;
  const css: Record<string, string | number> = {};
  if (s.stroke) css.stroke = s.stroke;
  if (s.strokeWidth !== undefined) css.strokeWidth = s.strokeWidth;
  return Object.keys(css).length > 0 ? css : undefined;
}

/**
 * Compare a computed edge CSS style against an existing edge style by value.
 * Serialises both to JSON for a safe structural comparison that avoids
 * unsafe type assertions between CSSProperties and plain records.
 */
function styleEqual(
  computed: Record<string, string | number>,
  existing: React.CSSProperties | undefined,
): boolean {
  if (!existing) return false;
  return JSON.stringify(computed) === JSON.stringify(existing);
}

/**
 * Merge updated labels and styles from a DiagramSpec onto already-
 * positioned React Flow edges. Bend points and positions are preserved.
 *
 * Returns the original array when nothing changed, preserving referential
 * equality so React Flow skips unnecessary re-renders.
 */
export function mergeEdgeStyles(positioned: Edge[], spec: DiagramSpec): Edge[] {
  const specEdgeMap = new Map(
    spec.edges.map((e) => [e.id, { style: e.style, label: e.label }]),
  );

  const merged: Edge[] = [];
  let anyChanged = false;

  for (const edge of positioned) {
    const specEdge = specEdgeMap.get(edge.id);
    if (!specEdge) {
      merged.push(edge);
      continue;
    }

    const newLabel = specEdge.label || edge.label;
    const computedStyle = edgeStyleToCss(specEdge.style);
    const newStyle = computedStyle ?? edge.style;
    if (
      newLabel === edge.label &&
      (!computedStyle || styleEqual(computedStyle, edge.style))
    ) {
      merged.push(edge);
      continue;
    }

    anyChanged = true;
    merged.push({ ...edge, label: newLabel, style: newStyle });
  }

  return anyChanged ? merged : positioned;
}

/**
 * Merge updated styles and data from a new DiagramSpec onto already-
 * positioned React Flow nodes. Positions remain untouched — only style
 * and data fields are updated.
 *
 * This avoids a full re-layout when only visual properties change.
 */
export function mergeStyles(positioned: Node[], spec: DiagramSpec): Node[] {
  const specNodeMap = new Map(spec.nodes.map((n) => [n.id, n]));
  const specGroupMap = new Map(spec.groups.map((g) => [g.id, g]));

  return positioned.map((node) => {
    const specNode = specNodeMap.get(node.id);
    const specGroup = specGroupMap.get(node.id);
    const style = specNode?.style ?? specGroup?.style;

    return {
      ...node,
      data: {
        ...node.data,
        label: specNode?.label ?? specGroup?.label ?? node.data.label,
        ...(specNode?.data ?? {}),
        nodeStyle: style,
      },
      style: buildNodeStyle(style),
    };
  });
}
