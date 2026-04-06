/**
 * Minimal reproduction test for the edge-label-disappearance bug.
 *
 * During simulation, edge labels disappear from the diagram. This test
 * exercises the full data pipeline: elkToFlow (initial layout) and
 * mergeEdgeStyles (style-only updates) to verify labels persist.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ElkNode, ElkExtendedEdge } from "elkjs";
import type { Edge } from "@xyflow/react";
import type { DiagramSpec } from "./types";
import { elkToFlow } from "./elk-to-flow";
import { mergeEdgeStyles } from "./merge-styles";

// ---------- Mock ELK that simulates compound-node edge redistribution ----------
// When hierarchyHandling=INCLUDE_CHILDREN, ELK may move edges from the root
// into compound (group) nodes. This mock reproduces that behaviour.
vi.mock("elkjs/lib/elk.bundled.js", () => {
  return {
    default: class MockELK {
      layout(graph: ElkNode) {
        return layoutWithCompound(graph);
      }
    },
  };
});

/**
 * Simple mock layout: position children linearly, add sections to edges,
 * and move edges whose source is inside a compound node INTO that compound.
 */
function layoutWithCompound(root: ElkNode): ElkNode {
  const childIdToParent = new Map<string, string>();
  for (const child of root.children ?? []) {
    for (const grandchild of child.children ?? []) {
      childIdToParent.set(grandchild.id, child.id);
    }
  }

  // Position children
  const positionedChildren = (root.children ?? []).map((child, i) => {
    const positioned: ElkNode = {
      ...child,
      x: i * 250,
      y: 0,
      width: child.width ?? 200,
      height: child.height ?? 150,
    };
    if (child.children) {
      positioned.children = child.children.map((gc, j) => ({
        ...gc,
        x: j * 180,
        y: 40,
        width: gc.width ?? 160,
        height: gc.height ?? 40,
      }));
    }
    return positioned;
  });

  // Redistribute edges: move edges into compound nodes if source is inside one
  const rootEdges: ElkExtendedEdge[] = [];
  const compoundEdges = new Map<string, ElkExtendedEdge[]>();

  for (const edge of root.edges ?? []) {
    const sourceParent = childIdToParent.get(edge.sources[0]);
    if (sourceParent) {
      let arr = compoundEdges.get(sourceParent);
      if (!arr) {
        arr = [];
        compoundEdges.set(sourceParent, arr);
      }
      arr.push(addSections(edge));
    } else {
      rootEdges.push(addSections(edge));
    }
  }

  // Attach redistributed edges to their compound nodes
  for (const child of positionedChildren) {
    const moved = compoundEdges.get(child.id);
    if (moved) {
      child.edges = [...(child.edges ?? []), ...moved];
    }
  }

  return {
    ...root,
    children: positionedChildren,
    edges: rootEdges,
  };
}

function addSections(edge: ElkExtendedEdge): ElkExtendedEdge {
  return {
    ...edge,
    sections: [
      {
        id: `s-${edge.id}`,
        startPoint: { x: 80, y: 40 },
        endPoint: { x: 280, y: 40 },
        bendPoints: [
          { x: 80, y: 100 },
          { x: 280, y: 100 },
        ],
      },
    ],
  };
}

import { useAutoLayout } from "./useAutoLayout";

// ---------- Tests ----------

describe("edge label persistence", () => {
  describe("elkToFlow with compound nodes", () => {
    it("preserves labels when edges are at root level", () => {
      const elkRoot: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 160, height: 40 },
          { id: "b", x: 200, y: 0, width: 160, height: 40 },
        ],
        edges: [
          {
            id: "e1",
            sources: ["a"],
            targets: ["b"],
            sections: [
              {
                id: "s1",
                startPoint: { x: 80, y: 40 },
                endPoint: { x: 280, y: 40 },
                bendPoints: [
                  { x: 80, y: 100 },
                  { x: 280, y: 100 },
                ],
              },
            ],
          },
        ],
      };
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", label: "connects" }],
        groups: [],
      };

      const { edges } = elkToFlow(elkRoot, spec);
      expect(edges[0].label).toBe("connects");
    });

    it("preserves labels when edges are inside compound nodes (INCLUDE_CHILDREN)", () => {
      // Simulate ELK moving an edge inside a compound node
      const elkRoot: ElkNode = {
        id: "root",
        children: [
          {
            id: "group1",
            x: 0,
            y: 0,
            width: 400,
            height: 200,
            children: [{ id: "a", x: 10, y: 40, width: 160, height: 40 }],
            // Edge placed inside compound node by ELK
            edges: [
              {
                id: "e1",
                sources: ["a"],
                targets: ["b"],
                sections: [
                  {
                    id: "s1",
                    startPoint: { x: 90, y: 80 },
                    endPoint: { x: 300, y: 80 },
                    bendPoints: [
                      { x: 90, y: 120 },
                      { x: 300, y: 120 },
                    ],
                  },
                ],
              },
            ],
          },
          { id: "b", x: 500, y: 0, width: 160, height: 40 },
        ],
        edges: [], // No edges at root - ELK moved it inside group1
      };
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A", parentId: "group1" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", label: "my-label" }],
        groups: [{ id: "group1", label: "Group 1" }],
      };

      const { edges } = elkToFlow(elkRoot, spec);
      expect(edges).toHaveLength(1);
      expect(edges[0].label).toBe("my-label");
      expect(edges[0].id).toBe("e1");
    });
  });

  describe("mergeEdgeStyles label persistence", () => {
    it("preserves labels across multiple merge cycles", () => {
      // Simulate the initial layout output
      const initialEdges: Edge[] = [
        {
          id: "e1",
          source: "a",
          target: "b",
          type: "elk",
          label: "request",
          data: {
            bendPoints: [
              { x: 0, y: 0 },
              { x: 100, y: 100 },
            ],
          },
        },
      ];

      // Simulate 10 rapid style-only spec changes (like during simulation)
      let currentEdges = initialEdges;
      for (let i = 0; i < 10; i++) {
        const spec: DiagramSpec = {
          nodes: [
            {
              id: "a",
              label: "A",
              style: { background: `#${String(i)}00000` },
            },
            { id: "b", label: "B" },
          ],
          edges: [{ id: "e1", source: "a", target: "b", label: "request" }],
          groups: [],
        };
        currentEdges = mergeEdgeStyles(currentEdges, spec);
        expect(currentEdges[0].label).toBe("request");
      }
    });

    it("preserves labels when spec edge has no style changes", () => {
      const edges: Edge[] = [
        {
          id: "e1",
          source: "a",
          target: "b",
          type: "elk",
          label: "original",
          data: { bendPoints: [] },
        },
      ];
      const spec: DiagramSpec = {
        nodes: [],
        edges: [{ id: "e1", source: "a", target: "b", label: "original" }],
        groups: [],
      };
      const merged = mergeEdgeStyles(edges, spec);
      expect(merged[0].label).toBe("original");
      // Bend points should be preserved
      expect(merged[0].data).toBe(edges[0].data);
    });

    it("preserves label from positioned edge when spec edge has no label", () => {
      const edges: Edge[] = [
        {
          id: "e1",
          source: "a",
          target: "b",
          type: "elk",
          label: "should-persist",
          data: { bendPoints: [] },
        },
      ];
      // Spec edge exists but has no label
      const spec: DiagramSpec = {
        nodes: [],
        edges: [{ id: "e1", source: "a", target: "b" }],
        groups: [],
      };
      const merged = mergeEdgeStyles(edges, spec);
      // The spread { ...edge } should preserve the existing label
      expect(merged[0].label).toBe("should-persist");
    });
  });

  describe("mergeEdgeStyles referential stability", () => {
    it("returns same array reference when nothing changed", () => {
      const edges: Edge[] = [
        {
          id: "e1",
          source: "a",
          target: "b",
          type: "elk",
          label: "request",
          style: { stroke: "#ff0000", strokeWidth: 2 },
          data: {
            bendPoints: [
              { x: 0, y: 0 },
              { x: 100, y: 100 },
            ],
          },
        },
      ];
      // Spec with identical label and style
      const spec: DiagramSpec = {
        nodes: [],
        edges: [
          {
            id: "e1",
            source: "a",
            target: "b",
            label: "request",
            style: { stroke: "#ff0000", strokeWidth: 2 },
          },
        ],
        groups: [],
      };
      const merged = mergeEdgeStyles(edges, spec);
      // Should be exact same array reference (no unnecessary re-render)
      expect(merged).toBe(edges);
    });

    it("returns same array reference across 100 identical merges", () => {
      const edges: Edge[] = [
        {
          id: "e1",
          source: "a",
          target: "b",
          type: "elk",
          label: "forward",
          data: { bendPoints: [] },
        },
      ];
      const spec: DiagramSpec = {
        nodes: [],
        edges: [{ id: "e1", source: "a", target: "b", label: "forward" }],
        groups: [],
      };
      // Simulate 100 rapid merge cycles (like during simulation at 60fps)
      let current = edges;
      for (let i = 0; i < 100; i++) {
        const next = mergeEdgeStyles(current, spec);
        expect(next).toBe(current);
        current = next;
      }
    });

    it("returns new array when style actually changes", () => {
      const edges: Edge[] = [
        {
          id: "e1",
          source: "a",
          target: "b",
          type: "elk",
          label: "request",
          style: { stroke: "#ff0000" },
          data: { bendPoints: [] },
        },
      ];
      const spec: DiagramSpec = {
        nodes: [],
        edges: [
          {
            id: "e1",
            source: "a",
            target: "b",
            label: "request",
            style: { stroke: "#00ff00" },
          },
        ],
        groups: [],
      };
      const merged = mergeEdgeStyles(edges, spec);
      expect(merged).not.toBe(edges);
      expect(merged[0].style).toEqual({ stroke: "#00ff00" });
      expect(merged[0].label).toBe("request");
    });
  });

  describe("useAutoLayout integration", () => {
    it("edge labels survive initial layout", async () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", label: "request" }],
        groups: [],
      };

      const { result } = renderHook(() => useAutoLayout(spec));

      await waitFor(() => {
        expect(result.current.layoutReady).toBe(true);
      });

      expect(result.current.edges).toHaveLength(1);
      expect(result.current.edges[0].label).toBe("request");
    });

    it("edge labels persist through style-only spec changes", async () => {
      const spec1: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", label: "request" }],
        groups: [],
      };

      const { result, rerender } = renderHook(
        ({ spec }) => useAutoLayout(spec),
        { initialProps: { spec: spec1 } },
      );

      await waitFor(() => {
        expect(result.current.layoutReady).toBe(true);
      });
      expect(result.current.edges[0].label).toBe("request");

      // Simulate rapid style-only changes (like during simulation)
      for (let i = 0; i < 5; i++) {
        const styledSpec: DiagramSpec = {
          ...spec1,
          nodes: spec1.nodes.map((n) => ({
            ...n,
            data: { metric: i },
          })),
        };
        rerender({ spec: styledSpec });
      }

      // Allow effects to settle
      await waitFor(() => {
        expect(result.current.edges[0].label).toBe("request");
      });
    });

    it("edge labels persist through size-triggered re-layout", async () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", label: "request" }],
        groups: [],
      };

      const { result, rerender } = renderHook(
        ({ spec, sizes }) => useAutoLayout(spec, undefined, sizes),
        {
          initialProps: {
            spec,
            sizes: undefined as
              | Record<string, { width: number; height: number }>
              | undefined,
          },
        },
      );

      await waitFor(() => {
        expect(result.current.layoutReady).toBe(true);
      });
      expect(result.current.edges[0].label).toBe("request");

      // Trigger size-based re-layout (like after node measurement)
      rerender({
        spec,
        sizes: { a: { width: 200, height: 60 }, b: { width: 200, height: 60 } },
      });

      await waitFor(() => {
        expect(result.current.edges[0].label).toBe("request");
      });
    });

    it("edge labels persist in compound graph through style changes", async () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A", parentId: "g1" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", label: "crosses-group" }],
        groups: [{ id: "g1", label: "Group" }],
      };

      const { result, rerender } = renderHook(
        ({ spec }) => useAutoLayout(spec),
        { initialProps: { spec } },
      );

      await waitFor(() => {
        expect(result.current.layoutReady).toBe(true);
      });
      expect(result.current.edges[0].label).toBe("crosses-group");

      // Style-only change
      const styledSpec: DiagramSpec = {
        ...spec,
        nodes: spec.nodes.map((n) => ({
          ...n,
          style: { background: "#ff0000" },
        })),
      };
      rerender({ spec: styledSpec });

      await waitFor(() => {
        expect(result.current.edges[0].label).toBe("crosses-group");
      });
    });
  });
});
