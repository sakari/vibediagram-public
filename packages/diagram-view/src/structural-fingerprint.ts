import type { DiagramSpec } from "./types";

/**
 * Compute a deterministic fingerprint from the structural shape of a
 * DiagramSpec. Two specs with the same node IDs, edges, groups, and
 * parent assignments produce the same fingerprint regardless of
 * differences in style, data, or labels.
 *
 * Used by useAutoLayout to decide whether a full re-layout is needed
 * or a lightweight style merge suffices.
 */
export function structuralFingerprint(spec: DiagramSpec): string {
  const parts: string[] = [];

  const sortedNodes = [...spec.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const n of sortedNodes) {
    parts.push(`n:${n.id}:${n.parentId ?? ""}`);
  }

  const sortedEdges = [...spec.edges].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sortedEdges) {
    parts.push(`e:${e.id}:${e.source}:${e.target}`);
  }

  const sortedGroups = [...spec.groups].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const g of sortedGroups) {
    parts.push(`g:${g.id}:${g.parentId ?? ""}`);
  }

  return parts.join("|");
}
