import { useState, useEffect, useRef, useCallback } from "react";
import type { Node, Edge } from "@xyflow/react";
import type ELKType from "elkjs/lib/elk.bundled.js";
import type { DiagramSpec, LayoutOptions } from "./types";
import { specToElk, type NodeSizeMap } from "./spec-to-elk";
import { elkToFlow } from "./elk-to-flow";
import { structuralFingerprint } from "./structural-fingerprint";
import { mergeStyles, mergeEdgeStyles } from "./merge-styles";

/** Lazy-loaded ELK singleton. Resolved from CDN via import map in production. */
let elkInstance: InstanceType<typeof ELKType> | null = null;
async function getElk(): Promise<InstanceType<typeof ELKType>> {
  if (!elkInstance) {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    elkInstance = new ELK();
  }
  return elkInstance;
}

export interface AutoLayoutResult {
  nodes: Node[];
  edges: Edge[];
  layoutReady: boolean;
}

/**
 * React hook that manages automatic ELK layout for a DiagramSpec.
 *
 * Re-runs layout only when the graph structure changes (nodes added/
 * removed, edges changed, parent assignments changed). When only
 * styles or data change, merges the new values onto existing positions
 * without invoking ELK — keeping layout stable and avoiding expensive
 * recomputation.
 *
 * Node sizing works via a CSS override that prevents React Flow from
 * constraining wrapper divs (see diagram-view.css). This lets content
 * determine the actual size. The measurement cycle in DiagramRenderer
 * captures DOM dimensions and feeds them back here, triggering a
 * re-layout with accurate sizes.
 */
export function useAutoLayout(
  spec: DiagramSpec,
  opts?: LayoutOptions,
  nodeSizes?: NodeSizeMap,
): AutoLayoutResult {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);

  const prevFingerprintRef = useRef("");
  const prevOptsRef = useRef<LayoutOptions | undefined>(undefined);
  const prevSizesFpRef = useRef("");
  const prevNodesRef = useRef<Node[]>([]);
  const prevEdgesRef = useRef<Edge[]>([]);
  const prevSpecEdgesRef = useRef<readonly import("./types").DiagramEdge[]>([]);
  const layoutVersionRef = useRef(0);

  const runLayout = useCallback(
    async (
      currentSpec: DiagramSpec,
      currentOpts: LayoutOptions | undefined,
      version: number,
      sizes?: NodeSizeMap,
    ) => {
      const elkGraph = specToElk(currentSpec, currentOpts, sizes);
      const elk = await getElk();
      const laidOut = await elk.layout(elkGraph);
      if (layoutVersionRef.current !== version) return;

      const result = elkToFlow(laidOut, currentSpec);
      setNodes(result.nodes);
      setEdges(result.edges);
      prevNodesRef.current = result.nodes;
      prevEdgesRef.current = result.edges;
      setLayoutReady(true);
    },
    [],
  );

  useEffect(() => {
    const fp = structuralFingerprint(spec);
    const sizesFp = nodeSizes ? JSON.stringify(nodeSizes) : "";
    const optsChanged = opts !== prevOptsRef.current;
    const sizesChanged = sizesFp !== prevSizesFpRef.current;
    prevOptsRef.current = opts;
    prevSizesFpRef.current = sizesFp;

    const structureChanged = fp !== prevFingerprintRef.current;
    if (structureChanged || optsChanged || sizesChanged) {
      prevFingerprintRef.current = fp;
      if (structureChanged || optsChanged) {
        setLayoutReady(false);
      }
      const version = ++layoutVersionRef.current;
      void runLayout(spec, opts, version, nodeSizes);
    } else if (prevNodesRef.current.length > 0) {
      const merged = mergeStyles(prevNodesRef.current, spec);
      setNodes(merged);
      prevNodesRef.current = merged;
      // Only merge edges when the spec's edge array actually changed
      // (topology update). On metrics-only frames, edges are unchanged.
      const specEdgesChanged = spec.edges !== prevSpecEdgesRef.current;
      if (specEdgesChanged) {
        prevSpecEdgesRef.current = spec.edges;
        if (prevEdgesRef.current.length > 0) {
          const mergedEdges = mergeEdgeStyles(prevEdgesRef.current, spec);
          setEdges(mergedEdges);
          prevEdgesRef.current = mergedEdges;
        }
      }
    }
  }, [spec, opts, nodeSizes, runLayout]);

  return { nodes, edges, layoutReady };
}
