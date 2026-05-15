import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  useStore,
  useOnViewportChange,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import "./diagram-view.css";
import type { CoordTransform } from "@diagram/draw-overlay";
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
  renderOverlay,
  colorMode,
}: DiagramRendererProps) {
  const [measuredSizes, setMeasuredSizes] = useState<NodeSizeMap | undefined>();
  const { nodes, edges, layoutReady } = useAutoLayout(
    spec,
    layoutOptions,
    measuredSizes,
  );
  const {
    getViewport,
    setViewport,
    screenToFlowPosition,
    flowToScreenPosition,
  } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevWidthRef = useRef<number | null>(null);

  // Subscribers registered through CoordTransform.subscribe — fired on every
  // pan/zoom so an attached overlay can re-render against the new viewport
  // without React itself re-rendering DiagramInner. A Set lets a subscriber
  // deregister cheaply via the returned unsubscribe.
  const viewportSubsRef = useRef(new Set<() => void>());
  useOnViewportChange({
    onChange: useCallback(() => {
      for (const cb of viewportSubsRef.current) cb();
    }, []),
  });

  // Rebuilt only when the React Flow projection helpers change identity
  // (effectively once per provider lifetime). Memoising keeps the
  // CoordTransform reference stable across renders so overlay components
  // can use it as an effect dependency without infinite loops.
  const transform = useMemo<CoordTransform>(
    () => ({
      toContent(clientX, clientY) {
        const p = screenToFlowPosition({ x: clientX, y: clientY });
        return { x: p.x, y: p.y };
      },
      toScreen(x, y) {
        // React Flow returns viewport-pixel coords. The overlay SVG is
        // positioned at `inset: 0` of the container, so its local origin
        // is `containerRef.current.getBoundingClientRect().{left,top}`.
        // Subtract that offset so the caller can use the result as
        // SVG-local coordinates (path `d`, `<g transform="translate(...)">`).
        const p = flowToScreenPosition({ x, y });
        const host = containerRef.current;
        // Defensive null-guard: the ref attaches before any DOM event
        // (and thus before the consumer ever calls toScreen). Excluded
        // from coverage because it's not realistically reachable.
        /* v8 ignore next */
        if (!host) return { left: p.x, top: p.y };
        const r = host.getBoundingClientRect();
        return { left: p.x - r.left, top: p.y - r.top };
      },
      subscribe(cb) {
        viewportSubsRef.current.add(cb);
        return () => {
          viewportSubsRef.current.delete(cb);
        };
      },
    }),
    [screenToFlowPosition, flowToScreenPosition],
  );

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

  const overlayNode = renderOverlay?.(transform);

  // Only add `position: relative` when an overlay is mounted so the
  // unchanged-DOM invariant for the default (no-overlay) consumer holds
  // byte-for-byte. The overlay host is `position: absolute; inset: 0` and
  // needs the container as its positioning ancestor.
  const containerStyle: React.CSSProperties =
    overlayNode != null
      ? { width: "100%", height: "100%", position: "relative" }
      : { width: "100%", height: "100%" };

  return (
    <div ref={containerRef} style={containerStyle}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={BUILTIN_EDGE_TYPES}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        fitView
        className={className}
        colorMode={colorMode}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      {/* Overlay host. Only mounted when a renderOverlay was supplied so
          that the default DOM tree is byte-identical to the pre-overlay
          version (visual regression baselines stay stable). The wrapper
          itself is pointer-events: none; the overlay opts in to events on
          its own children so clicks fall through when drawing is off. */}
      {overlayNode != null ? (
        <div className="diagram-view-overlay-host">{overlayNode}</div>
      ) : null}
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
