import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Node, Edge } from "@xyflow/react";
import { mergeStyles, mergeEdgeStyles } from "./merge-styles";
import type { DiagramSpec, DiagramNode, NodeStyle } from "./types";

function makePositionedNode(
  id: string,
  x: number,
  y: number,
  style?: Record<string, unknown>,
): Node {
  return {
    id,
    position: { x, y },
    data: { label: id },
    ...(style ? { style } : {}),
  };
}

const arbNodeStyle: fc.Arbitrary<NodeStyle> = fc.record({
  background: fc.option(fc.constant("#ff0000"), { nil: undefined }),
  borderColor: fc.option(fc.constant("#00ff00"), { nil: undefined }),
  opacity: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
    nil: undefined,
  }),
});

const arbPositionedNodesAndSpec = fc
  .integer({ min: 1, max: 10 })
  .chain((count) =>
    fc
      .tuple(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 1000 }),
            y: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: count, maxLength: count },
        ),
        fc.array(arbNodeStyle, { minLength: count, maxLength: count }),
      )
      .map(([positions, styles]) => {
        const nodes: Node[] = positions.map((pos, i) =>
          makePositionedNode(`n${String(i)}`, pos.x, pos.y),
        );
        const specNodes: DiagramNode[] = positions.map((_, i) => ({
          id: `n${String(i)}`,
          label: `Updated ${String(i)}`,
          style: styles[i],
          data: { updated: true },
        }));
        const spec: DiagramSpec = { nodes: specNodes, edges: [], groups: [] };
        return { nodes, spec, positions };
      }),
  );

describe("mergeStyles", () => {
  it("[prop-positions-stable] positions are unchanged after merge", () => {
    fc.assert(
      fc.property(arbPositionedNodesAndSpec, ({ nodes, spec, positions }) => {
        const merged = mergeStyles(nodes, spec);
        for (let i = 0; i < merged.length; i++) {
          expect(merged[i].position).toEqual(positions[i]);
        }
      }),
    );
  });

  it("[prop-styles-updated] styles from new spec appear on merged nodes", () => {
    fc.assert(
      fc.property(arbPositionedNodesAndSpec, ({ nodes, spec }) => {
        const merged = mergeStyles(nodes, spec);
        for (let i = 0; i < merged.length; i++) {
          const specNode = spec.nodes[i];
          if (specNode.style?.background) {
            expect(merged[i].style?.background).toBe(specNode.style.background);
          }
        }
      }),
    );
  });

  it("example: position stays, style updates", () => {
    const positioned = [makePositionedNode("a", 100, 200)];
    const spec: DiagramSpec = {
      nodes: [
        {
          id: "a",
          label: "A",
          style: { background: "#ff0000", borderColor: "#0000ff" },
        },
      ],
      edges: [],
      groups: [],
    };
    const merged = mergeStyles(positioned, spec);
    expect(merged[0].position).toEqual({ x: 100, y: 200 });
    expect(merged[0].style?.background).toBe("#ff0000");
    expect(merged[0].style?.borderColor).toBe("#0000ff");
  });

  it("example: removing style clears previous styling", () => {
    const positioned: Node[] = [
      {
        id: "a",
        position: { x: 100, y: 200 },
        data: { label: "A", nodeStyle: { background: "#ff0000" } },
        style: { background: "#ff0000" },
      },
    ];
    const spec: DiagramSpec = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      groups: [],
    };
    const merged = mergeStyles(positioned, spec);
    expect(merged[0].style).toBeUndefined();
    expect(merged[0].data.nodeStyle).toBeUndefined();
  });

  it("example: data is merged from new spec", () => {
    const positioned = [makePositionedNode("a", 50, 50)];
    const spec: DiagramSpec = {
      nodes: [{ id: "a", label: "A", data: { gauge: 0.9 } }],
      edges: [],
      groups: [],
    };
    const merged = mergeStyles(positioned, spec);
    expect(merged[0].data.gauge).toBe(0.9);
  });

  describe("branch coverage", () => {
    it("[ms-group-style] applies group style when node is a group", () => {
      const positioned: Node[] = [
        {
          id: "g1",
          position: { x: 0, y: 0 },
          data: { label: "Old Label" },
        },
      ];
      const spec: DiagramSpec = {
        nodes: [],
        edges: [],
        groups: [
          { id: "g1", label: "Group 1", style: { background: "#abcdef" } },
        ],
      };
      const merged = mergeStyles(positioned, spec);
      expect(merged[0].data.label).toBe("Group 1");
      expect(merged[0].data.nodeStyle).toEqual({ background: "#abcdef" });
    });

    it("[ms-fallback-label] keeps original label when no spec node or group", () => {
      const positioned: Node[] = [
        {
          id: "unknown",
          position: { x: 10, y: 20 },
          data: { label: "Original" },
        },
      ];
      const spec: DiagramSpec = { nodes: [], edges: [], groups: [] };
      const merged = mergeStyles(positioned, spec);
      expect(merged[0].data.label).toBe("Original");
    });

    it("[ms-no-style] undefined style produces undefined nodeStyle and style", () => {
      const positioned: Node[] = [
        {
          id: "a",
          position: { x: 0, y: 0 },
          data: { label: "A" },
        },
      ];
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [],
      };
      const merged = mergeStyles(positioned, spec);
      expect(merged[0].data.nodeStyle).toBeUndefined();
      expect(merged[0].style).toBeUndefined();
    });

    it("[ms-shape] preserves shape when merging updated styles", () => {
      const positioned: Node[] = [
        {
          id: "a",
          position: { x: 50, y: 75 },
          data: { label: "A" },
        },
      ];
      const spec: DiagramSpec = {
        nodes: [
          {
            id: "a",
            label: "A",
            style: { background: "#ff0000", shape: "cylinder" },
          },
        ],
        edges: [],
        groups: [],
      };
      const merged = mergeStyles(positioned, spec);
      expect(merged[0].position).toEqual({ x: 50, y: 75 });
      expect(merged[0].data.nodeStyle).toEqual(
        expect.objectContaining({ shape: "cylinder", background: "#ff0000" }),
      );
    });
  });
});

describe("mergeEdgeStyles", () => {
  const baseEdge: Edge = {
    id: "e1",
    source: "a",
    target: "b",
    type: "elk",
    data: {
      bendPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
    },
  };

  it("merges label from spec onto positioned edge", () => {
    const spec: DiagramSpec = {
      nodes: [],
      edges: [{ id: "e1", source: "a", target: "b", label: "request" }],
      groups: [],
    };
    const merged = mergeEdgeStyles([baseEdge], spec);
    expect(merged[0].label).toBe("request");
    expect(merged[0].data).toBe(baseEdge.data);
  });

  it("merges edge style from spec", () => {
    const spec: DiagramSpec = {
      nodes: [],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          style: { stroke: "#ff0000", strokeWidth: 3 },
        },
      ],
      groups: [],
    };
    const merged = mergeEdgeStyles([baseEdge], spec);
    expect(merged[0].style).toEqual({ stroke: "#ff0000", strokeWidth: 3 });
  });

  it("preserves edge when not in spec", () => {
    const spec: DiagramSpec = { nodes: [], edges: [], groups: [] };
    const merged = mergeEdgeStyles([baseEdge], spec);
    expect(merged[0]).toBe(baseEdge);
  });

  it("preserves existing style when spec edge has no style", () => {
    const edgeWithStyle: Edge = { ...baseEdge, style: { stroke: "blue" } };
    const spec: DiagramSpec = {
      nodes: [],
      edges: [{ id: "e1", source: "a", target: "b" }],
      groups: [],
    };
    const merged = mergeEdgeStyles([edgeWithStyle], spec);
    expect(merged[0].style).toEqual({ stroke: "blue" });
  });
});
