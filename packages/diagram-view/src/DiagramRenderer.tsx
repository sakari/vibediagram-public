import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  useStore,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import "./diagram-view.css";
import type { DiagramRendererProps } from "./types";
import { useAutoLayout } from "./useAutoLayout";
import type { NodeSizeMap } from "./spec-to-elk";
import { ElkEdge } from "./ElkEdge";
import { DefaultNode } from "./DefaultNode";
import { GroupNode } from "./GroupNode";

/**
 * Compare measured node dimensions against previously captured sizes.
 * Returns new sizes if any node differs by more than 1px, otherwise undefined.
 */
export function extractChangedSizes(
  flowNodes: Node[],
  prevSizes: NodeSizeMap | undefined,
): NodeSizeMap | undefined {
  const sizes: NodeSizeMap = {};
  let anyDifferent = false;

  for (const n of flowNodes) {
    const w = n.measured?.width;
    const h = n.measured?.height;
    if (w != null && h != null) {
      sizes[n.id] = { width: w, height: h };
      const prev = prevSizes?.[n.id];
      if (
        !prev ||
        Math.abs(prev.width - w) > 1 ||
        Math.abs(prev.height - h) > 1
      ) {
        anyDifferent = true;
      }
    }
  }

  return anyDifferent && Object.keys(sizes).length > 0 ? sizes : undefined;
}

/**
 * Build a fingerprint string from React Flow's measured node sizes.
 * Used to detect content-driven size changes after initial convergence.
 */
export function measuredSizesFingerprint(
  nodes: readonly {
    id: string;
    measured?: { width?: number; height?: number };
  }[],
): string {
  let fp = "";
  for (const n of nodes) {
    const m = n.measured;
    if (m != null && m.width != null && m.height != null) {
      fp += `${n.id}:${String(Math.round(m.width))}x${String(Math.round(m.height))},`;
    }
  }
  return fp;
}

const BUILTIN_NODE_TYPES = {
  default: DefaultNode,
  group: GroupNode,
};

const BUILTIN_EDGE_TYPES = {
  elk: ElkEdge,
};

/**
 * Inner component that uses the ReactFlow hooks (requires ReactFlowProvider).
 */
function DiagramInner({
  spec,
  nodeTypes: consumerNodeTypes,
  onNodeClick,
  onNodeDrag,
  layoutOptions,
  className,
}: DiagramRendererProps) {
  const [measuredSizes, setMeasuredSizes] = useState<NodeSizeMap | undefined>();
  const { nodes, edges, layoutReady } = useAutoLayout(
    spec,
    layoutOptions,
    measuredSizes,
  );
  const { getViewport, setViewport } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevWidthRef = useRef<number | null>(null);

  // Track structural fingerprint to know when to re-measure
  const prevStructureRef = useRef("");
  // Cap measurement passes to prevent infinite loops if node sizes oscillate
  const measurePassRef = useRef(0);
  const MAX_MEASURE_PASSES = 3;
  // Track the previous measured-sizes fingerprint to detect content-driven changes
  const prevMeasuredFpRef = useRef("");

  // Subscribe to React Flow's internal node measurement state.
  // We read from nodeLookup (internal nodes) rather than s.nodes because
  // RF only sets `measured` on internal nodes — propagating to s.nodes
  // requires onNodesChange, which we don't use (layout is ELK-driven).
  const nodesInitialized = useStore((s) => {
    if (s.nodeLookup.size === 0) return false;
    for (const n of s.nodeLookup.values()) {
      const m = n.measured;
      if (m.width == null || m.height == null) return false;
    }
    return true;
  });

  // Build a fingerprint of all measured sizes so we detect content-driven
  // size changes (e.g. a table gaining rows) even after initial convergence.
  // The CSS override (width/height: max-content !important) makes wrappers
  // auto-size to content, so node.measured reflects intrinsic dimensions.
  // Read internal nodes with measured dimensions for size extraction.
  // NOTE: This selector creates a new array every call, so useStore will
  // re-render on every store update. This is intentional — the derived
  // measuredSizesFp fingerprint is the actual change-detection mechanism.
  const internalNodes: Node[] = useStore((s) => {
    const result: Node[] = [];
    for (const n of s.nodeLookup.values()) {
      result.push(n);
    }
    return result;
  });

  const measuredSizesFp = measuredSizesFingerprint(internalNodes);

  // When nodes are measured, extract sizes and feed back to layout.
  // Also re-runs when measuredSizesFp changes (content resized).
  // The effect body is covered by the browser spike; jsdom cannot
  // exercise React Flow's internal ResizeObserver measurement.
  useEffect(() => {
    /* v8 ignore next -- guarded by layoutReady render gate */
    if (!nodesInitialized || !layoutReady) return;
    /* v8 ignore start -- pass counter logic tested via browser spike */
    if (
      prevMeasuredFpRef.current !== "" &&
      measuredSizesFp !== prevMeasuredFpRef.current &&
      measurePassRef.current >= MAX_MEASURE_PASSES
    ) {
      measurePassRef.current = 0;
    }
    prevMeasuredFpRef.current = measuredSizesFp;
    if (measurePassRef.current >= MAX_MEASURE_PASSES) return;
    const changed = extractChangedSizes(internalNodes, measuredSizes);
    if (changed) {
      measurePassRef.current++;
      setMeasuredSizes(changed);
    }
    /* v8 ignore stop */
  }, [
    nodesInitialized,
    layoutReady,
    internalNodes,
    measuredSizes,
    measuredSizesFp,
  ]);

  // Reset measurement pass counter when structure changes so the
  // measurement cycle can re-run for newly added nodes. We deliberately
  // keep the existing measuredSizes: clearing them would force every node
  // back to the default 160×40 and cause a jarring intermediate layout.
  // Existing sizes remain valid and new nodes simply use defaults until
  // the next measurement pass picks them up.
  useEffect(() => {
    const fp =
      JSON.stringify(spec.nodes.map((n) => n.id).sort()) +
      JSON.stringify(spec.groups.map((g) => g.id).sort());
    if (fp !== prevStructureRef.current) {
      prevStructureRef.current = fp;
      measurePassRef.current = 0;
    }
  }, [spec]);

  // Adjust viewport to maintain the same center point when the container resizes
  // (e.g. editor collapse/expand). This preserves user pan/zoom instead of resetting.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !layoutReady) return;
    prevWidthRef.current = el.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const newWidth = entries[0].contentRect.width;
      const oldWidth = prevWidthRef.current;
      prevWidthRef.current = newWidth;
      if (oldWidth === null || oldWidth === newWidth) return;
      requestAnimationFrame(() => {
        const vp = getViewport();
        void setViewport({
          x: vp.x + (newWidth - oldWidth) / 2,
          y: vp.y,
          zoom: vp.zoom,
        });
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [layoutReady, getViewport, setViewport]);

  const nodeTypes = useMemo(
    () => ({
      ...BUILTIN_NODE_TYPES,
      ...consumerNodeTypes,
    }),
    [consumerNodeTypes],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeDrag?.(node.id, node.position);
    },
    [onNodeDrag],
  );

  if (!layoutReady) {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
        }}
        data-testid="diagram-loading"
      >
        Computing layout...
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={BUILTIN_EDGE_TYPES}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        fitView
        className={className}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

/**
 * Top-level diagram renderer component. Accepts a library-agnostic
 * DiagramSpec and renders an interactive, automatically laid-out
 * diagram using React Flow and ELKjs.
 *
 * Wraps the inner component in ReactFlowProvider so hooks work.
 * Consumer can supply custom nodeTypes to override default rendering.
 */
export function DiagramRenderer(props: DiagramRendererProps) {
  return (
    <ReactFlowProvider>
      <DiagramInner {...props} />
    </ReactFlowProvider>
  );
}
