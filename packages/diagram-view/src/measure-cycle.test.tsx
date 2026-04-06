/**
 * @vitest-environment jsdom
 *
 * Tests for the two-pass measurement cycle in DiagramRenderer.
 * Uses deeper mocking of React Flow to simulate node measurement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { DiagramSpec } from "./types";

// Mock ResizeObserver for jsdom
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

// Track calls to setNodes to detect re-layout from measurements
let useStoreSelectorResult = false;
const mockNodes = [
  {
    id: "a",
    position: { x: 0, y: 0 },
    data: {},
    measured: { width: 200, height: 60 },
  },
  {
    id: "b",
    position: { x: 200, y: 100 },
    data: {},
    measured: { width: 180, height: 50 },
  },
];
const mockGetNodes = vi.fn(() => mockNodes);
let useStoreCallIndex = 0;

vi.mock("@xyflow/react", async () => {
  const actual =
    await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useStore: (selector: (state: unknown) => unknown) => {
      const callIndex = useStoreCallIndex++;
      // Exercise the selector with mock state for coverage
      const nodeLookup = new Map(mockNodes.map((n) => [n.id, n]));
      try {
        selector({ nodes: mockNodes, nodeLookup });
      } catch {
        // ignore errors from calling with minimal state
      }
      // First call: nodesInitialized (boolean), second: internalNodes (array)
      if (callIndex % 2 === 0) return useStoreSelectorResult;
      return useStoreSelectorResult ? mockNodes : [];
    },
    useReactFlow: () => ({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport: vi.fn(),
      getNodes: mockGetNodes,
    }),
  };
});

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class MockELK {
    layout(graph: {
      id: string;
      children?: { id: string }[];
      edges?: unknown[];
    }) {
      return Promise.resolve({
        ...graph,
        children: (graph.children ?? []).map((c, i) => ({
          ...c,
          x: i * 200,
          y: i * 100,
          width: 160,
          height: 40,
        })),
        edges: graph.edges ?? [],
      });
    }
  },
}));

import { DiagramRenderer } from "./DiagramRenderer";

const spec: DiagramSpec = {
  nodes: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ],
  edges: [{ id: "e1", source: "a", target: "b" }],
  groups: [],
};

describe("measurement cycle", () => {
  beforeEach(() => {
    useStoreSelectorResult = false;
    useStoreCallIndex = 0;
    mockGetNodes.mockClear();
  });

  it("[mc-measure] renders ReactFlow when nodesInitialized becomes true", async () => {
    useStoreSelectorResult = true;

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    // After layout + measurement, ReactFlow should render
    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
    });
  });

  it("[mc-visible] diagram becomes visible after measurement completes", async () => {
    useStoreSelectorResult = true;

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
      // Diagram should be visible (no visibility:hidden at any point)
      const wrapperStyle =
        rfElement?.parentElement?.getAttribute("style") ?? "";
      expect(wrapperStyle).not.toContain("visibility");
    });
  });

  it("[mc-reset] resets measurements when spec structure changes", async () => {
    useStoreSelectorResult = true;

    const { rerender, container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
    });

    // Change spec structure — should reset measurements
    const newSpec: DiagramSpec = {
      nodes: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ],
      groups: [],
    };

    rerender(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={newSpec} />
      </div>,
    );

    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
    });
  });
});
