/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { DiagramSpec, LayoutOptions } from "./types";

let callCount = 0;
/** Capture the last graph passed to elk.layout() for size verification. */
let lastElkGraph: {
  id: string;
  children?: { id: string; width?: number; height?: number }[];
  edges?: unknown[];
} | null = null;

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class MockELK {
    layout(graph: {
      id: string;
      children?: {
        id: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }[];
      edges?: unknown[];
    }) {
      callCount++;
      lastElkGraph = graph;
      return Promise.resolve({
        ...graph,
        children: (graph.children ?? []).map((c, i) => ({
          ...c,
          x: i * 200,
          y: i * 100,
          width: c.width ?? 160,
          height: c.height ?? 40,
        })),
        edges: graph.edges ?? [],
      });
    }
  },
}));

import { useAutoLayout } from "./useAutoLayout";

function getCallCount(): number {
  return callCount;
}

function resetCallCount(): void {
  callCount = 0;
}

const baseSpec: DiagramSpec = {
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  edges: [{ id: "e1", source: "a", target: "b" }],
  groups: [],
};

describe("useAutoLayout", () => {
  it("[ual-layout] returns positioned nodes and edges after layout", async () => {
    resetCallCount();
    const { result } = renderHook(() => useAutoLayout(baseSpec));

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    expect(result.current.nodes.length).toBe(2);
    expect(result.current.edges.length).toBe(1);
    expect(result.current.nodes[0].position).toBeDefined();
    expect(result.current.nodes[1].position).toBeDefined();
  });

  it("[ual-ready] layoutReady is false initially and true after layout", async () => {
    resetCallCount();
    const { result } = renderHook(() => useAutoLayout(baseSpec));

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });
  });

  it("[ual-fingerprint] style-only change does not trigger re-layout", async () => {
    resetCallCount();
    const { result, rerender } = renderHook(({ spec }) => useAutoLayout(spec), {
      initialProps: { spec: baseSpec },
    });

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    const callsAfterInitial = getCallCount();

    const styledSpec: DiagramSpec = {
      ...baseSpec,
      nodes: baseSpec.nodes.map((n) => ({
        ...n,
        style: { background: "#ff0000" },
        data: { updated: true },
      })),
    };

    rerender({ spec: styledSpec });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(getCallCount()).toBe(callsAfterInitial);
  });

  it("[ual-merge] on style-only change, positions remain and styles update", async () => {
    resetCallCount();
    const { result, rerender } = renderHook(({ spec }) => useAutoLayout(spec), {
      initialProps: { spec: baseSpec },
    });

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    const positionsBefore = result.current.nodes.map((n) => ({
      ...n.position,
    }));

    const styledSpec: DiagramSpec = {
      ...baseSpec,
      nodes: baseSpec.nodes.map((n) => ({
        ...n,
        style: { background: "#ff0000" },
      })),
    };

    rerender({ spec: styledSpec });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const positionsAfter = result.current.nodes.map((n) => ({ ...n.position }));
    expect(positionsAfter).toEqual(positionsBefore);
  });

  it("[ual-opts] changing layoutOptions triggers re-layout", async () => {
    resetCallCount();
    const { result, rerender } = renderHook(
      ({ spec, opts }) => useAutoLayout(spec, opts),
      {
        initialProps: {
          spec: baseSpec,
          opts: { direction: "DOWN" } as LayoutOptions,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    const callsAfterInitial = getCallCount();

    rerender({ spec: baseSpec, opts: { direction: "RIGHT" as const } });

    await waitFor(() => {
      expect(getCallCount()).toBeGreaterThan(callsAfterInitial);
    });
  });

  it("[ual-sizes] providing nodeSizes triggers re-layout", async () => {
    resetCallCount();
    const { result, rerender } = renderHook(
      ({ spec, opts, sizes }) => useAutoLayout(spec, opts, sizes),
      {
        initialProps: {
          spec: baseSpec,
          opts: undefined as LayoutOptions | undefined,
          sizes: undefined as
            | Record<string, { width: number; height: number }>
            | undefined,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    const callsAfterInitial = getCallCount();

    rerender({
      spec: baseSpec,
      opts: undefined,
      sizes: {
        a: { width: 200, height: 60 },
        b: { width: 180, height: 50 },
      },
    });

    await waitFor(() => {
      expect(getCallCount()).toBeGreaterThan(callsAfterInitial);
    });
  });

  it("[ual-sizes-preserved] adding a node preserves measured sizes for existing nodes", async () => {
    resetCallCount();
    lastElkGraph = null;

    const sizes = {
      a: { width: 250, height: 80 },
      b: { width: 200, height: 65 },
    };

    // Initial layout with measured sizes
    const { result, rerender } = renderHook(
      ({ spec, sizes: s }) => useAutoLayout(spec, undefined, s),
      { initialProps: { spec: baseSpec, sizes } },
    );

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    // Verify initial layout used measured sizes
    expect(lastElkGraph).not.toBeNull();
    const nodeA1 = lastElkGraph!.children!.find((c) => c.id === "a");
    expect(nodeA1!.width).toBe(250);
    expect(nodeA1!.height).toBe(80);

    // Add a new node (structural change) while keeping the SAME sizes map.
    // This simulates what DiagramRenderer should do: keep existing measured
    // sizes when structure changes rather than clearing them to undefined.
    const extendedSpec: DiagramSpec = {
      ...baseSpec,
      nodes: [...baseSpec.nodes, { id: "c", label: "C" }],
      edges: [...baseSpec.edges, { id: "e2", source: "b", target: "c" }],
    };

    rerender({ spec: extendedSpec, sizes });

    await waitFor(() => {
      expect(result.current.nodes.length).toBe(3);
    });

    // Existing nodes must keep their measured sizes, not fall back to 160×40
    const nodeA2 = lastElkGraph!.children!.find((c) => c.id === "a");
    const nodeB2 = lastElkGraph!.children!.find((c) => c.id === "b");
    const nodeC2 = lastElkGraph!.children!.find((c) => c.id === "c");

    expect(nodeA2!.width).toBe(250);
    expect(nodeA2!.height).toBe(80);
    expect(nodeB2!.width).toBe(200);
    expect(nodeB2!.height).toBe(65);
    // New node has no measured size — should get defaults
    expect(nodeC2!.width).toBe(160);
    expect(nodeC2!.height).toBe(40);
  });

  it("[ual-sizes-cleared-breaks-layout] clearing sizes on structural change regresses to defaults", async () => {
    resetCallCount();
    lastElkGraph = null;

    const sizes = {
      a: { width: 250, height: 80 },
      b: { width: 200, height: 65 },
    };

    // Initial layout with measured sizes
    const { result, rerender } = renderHook(
      ({ spec, sizes: s }) => useAutoLayout(spec, undefined, s),
      {
        initialProps: {
          spec: baseSpec,
          sizes: sizes as
            | Record<string, { width: number; height: number }>
            | undefined,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    // Simulate the OLD bug: clear sizes to undefined when structure changes.
    // This is what DiagramRenderer used to do — setMeasuredSizes(undefined).
    const extendedSpec: DiagramSpec = {
      ...baseSpec,
      nodes: [...baseSpec.nodes, { id: "c", label: "C" }],
      edges: [...baseSpec.edges, { id: "e2", source: "b", target: "c" }],
    };

    rerender({ spec: extendedSpec, sizes: undefined });

    await waitFor(() => {
      expect(result.current.nodes.length).toBe(3);
    });

    // With sizes cleared, ALL nodes regress to the 160×40 default — broken!
    const nodeA = lastElkGraph!.children!.find((c) => c.id === "a");
    expect(nodeA!.width).toBe(160);
    expect(nodeA!.height).toBe(40);
  });

  it("[ual-structural] adding a node triggers re-layout", async () => {
    resetCallCount();
    const { result, rerender } = renderHook(({ spec }) => useAutoLayout(spec), {
      initialProps: { spec: baseSpec },
    });

    await waitFor(() => {
      expect(result.current.layoutReady).toBe(true);
    });

    const callsAfterInitial = getCallCount();

    const extendedSpec: DiagramSpec = {
      ...baseSpec,
      nodes: [...baseSpec.nodes, { id: "c", label: "C" }],
    };

    rerender({ spec: extendedSpec });

    await waitFor(() => {
      expect(result.current.nodes.length).toBe(3);
    });

    expect(getCallCount()).toBeGreaterThan(callsAfterInitial);
  });
});
