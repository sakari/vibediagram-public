import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { ElkNode, ElkExtendedEdge } from "elkjs";
import { elkToFlow } from "./elk-to-flow";
import type {
  DiagramSpec,
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
  NodeStyle,
  Point,
} from "./types";

function isPoint(v: unknown): v is Point {
  return (
    typeof v === "object" &&
    v !== null &&
    "x" in v &&
    "y" in v &&
    typeof v.x === "number" &&
    typeof v.y === "number"
  );
}

/**
 * Generate a paired (ElkNode, DiagramSpec) where the ELK tree has
 * positions and sections that match the spec's topology.
 */
const arbHexColor = fc
  .tuple(
    fc.constantFrom(...Array.from("0123456789abcdef")),
    fc.constantFrom(...Array.from("0123456789abcdef")),
    fc.constantFrom(...Array.from("0123456789abcdef")),
    fc.constantFrom(...Array.from("0123456789abcdef")),
    fc.constantFrom(...Array.from("0123456789abcdef")),
    fc.constantFrom(...Array.from("0123456789abcdef")),
  )
  .map((chars) => `#${chars.join("")}`);

const arbNodeStyle: fc.Arbitrary<NodeStyle> = fc.record({
  background: fc.option(arbHexColor, { nil: undefined }),
  borderColor: fc.option(arbHexColor, { nil: undefined }),
  borderWidth: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
  opacity: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
    nil: undefined,
  }),
});

const arbElkAndSpec: fc.Arbitrary<{ elk: ElkNode; spec: DiagramSpec }> = fc
  .record({
    nodeCount: fc.integer({ min: 1, max: 10 }),
    groupCount: fc.integer({ min: 0, max: 3 }),
  })
  .chain(({ nodeCount, groupCount }) => {
    const groups: DiagramGroup[] = Array.from(
      { length: groupCount },
      (_, i) => ({
        id: `g${String(i)}`,
        label: `Group ${String(i)}`,
      }),
    );
    const groupIds = groups.map((g) => g.id);

    return fc
      .tuple(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 1000 }),
            y: fc.integer({ min: 0, max: 1000 }),
            style: arbNodeStyle,
          }),
          { minLength: nodeCount, maxLength: nodeCount },
        ),
        fc.array(
          fc.record({
            sourceIdx: fc.integer({ min: 0, max: nodeCount - 1 }),
            targetIdx: fc.integer({ min: 0, max: nodeCount - 1 }),
            bendCount: fc.integer({ min: 0, max: 4 }),
          }),
          { minLength: 0, maxLength: nodeCount },
        ),
        fc.array(fc.integer({ min: 0, max: 500 }), {
          minLength: 0,
          maxLength: 20,
        }),
      )
      .map(
        ([nodePositions, edgeDefs, bendCoords]): {
          elk: ElkNode;
          spec: DiagramSpec;
        } => {
          const specNodes: DiagramNode[] = nodePositions.map((pos, i) => ({
            id: `n${String(i)}`,
            label: `Node ${String(i)}`,
            parentId:
              groupIds.length > 0 && i % 3 === 0
                ? groupIds[i % groupIds.length]
                : undefined,
            style: pos.style,
            data: { value: i },
          }));

          const groupChildMap = new Map<string, ElkNode[]>();
          for (const g of groups) groupChildMap.set(g.id, []);

          const rootElkChildren: ElkNode[] = [];
          for (let i = 0; i < nodeCount; i++) {
            const elkChild: ElkNode = {
              id: `n${String(i)}`,
              x: nodePositions[i].x,
              y: nodePositions[i].y,
              width: 160,
              height: 40,
            };
            const parent = specNodes[i].parentId;
            if (parent && groupChildMap.has(parent)) {
              groupChildMap.get(parent)!.push(elkChild);
            } else {
              rootElkChildren.push(elkChild);
            }
          }

          for (const g of groups) {
            rootElkChildren.push({
              id: g.id,
              x: 0,
              y: 0,
              width: 400,
              height: 300,
              children: groupChildMap.get(g.id) ?? [],
            });
          }

          let bcIdx = 0;
          const specEdges: DiagramEdge[] = [];
          const elkEdges: ElkExtendedEdge[] = edgeDefs
            .filter((e) => e.sourceIdx !== e.targetIdx)
            .map((e, i) => {
              specEdges.push({
                id: `e${String(i)}`,
                source: `n${String(e.sourceIdx)}`,
                target: `n${String(e.targetIdx)}`,
              });
              const bendPoints: Point[] = Array.from(
                { length: e.bendCount },
                () => ({
                  x: bendCoords[bcIdx++ % Math.max(bendCoords.length, 1)] ?? 50,
                  y: bendCoords[bcIdx++ % Math.max(bendCoords.length, 1)] ?? 50,
                }),
              );
              return {
                id: `e${String(i)}`,
                sources: [`n${String(e.sourceIdx)}`],
                targets: [`n${String(e.targetIdx)}`],
                sections: [
                  {
                    id: `s${String(i)}`,
                    startPoint: {
                      x: nodePositions[e.sourceIdx].x,
                      y: nodePositions[e.sourceIdx].y,
                    },
                    endPoint: {
                      x: nodePositions[e.targetIdx].x,
                      y: nodePositions[e.targetIdx].y,
                    },
                    bendPoints,
                  },
                ],
              };
            });

          const spec: DiagramSpec = {
            nodes: specNodes,
            edges: specEdges,
            groups,
          };
          const elk: ElkNode = {
            id: "root",
            children: rootElkChildren,
            edges: elkEdges,
          };
          return { elk, spec };
        },
      );
  });

describe("elkToFlow", () => {
  describe("fast-check properties", () => {
    it("[prop-position-present] every ELK node with coordinates produces a positioned RF node", () => {
      fc.assert(
        fc.property(arbElkAndSpec, ({ elk, spec }) => {
          const { nodes } = elkToFlow(elk, spec);
          const nodeMap = new Map(nodes.map((n) => [n.id, n]));

          for (const n of spec.nodes) {
            const rfNode = nodeMap.get(n.id);
            expect(rfNode).toBeDefined();

            expect(rfNode!.position).toBeDefined();

            expect(typeof rfNode!.position.x).toBe("number");

            expect(typeof rfNode!.position.y).toBe("number");
          }
        }),
      );
    });

    it("[prop-parent-preserved] ELK child nodes get correct parentId on RF nodes", () => {
      fc.assert(
        fc.property(arbElkAndSpec, ({ elk, spec }) => {
          const { nodes } = elkToFlow(elk, spec);
          const nodeMap = new Map(nodes.map((n) => [n.id, n]));
          const groupIds = new Set(spec.groups.map((g) => g.id));

          for (const sn of spec.nodes) {
            if (sn.parentId && groupIds.has(sn.parentId)) {
              const rfNode = nodeMap.get(sn.id);
              expect(rfNode?.parentId).toBe(sn.parentId);
            }
          }
        }),
      );
    });

    it("[prop-bendpoints-extracted] ELK edge sections produce data.bendPoints on RF edges", () => {
      fc.assert(
        fc.property(arbElkAndSpec, ({ elk, spec }) => {
          const { edges } = elkToFlow(elk, spec);

          for (const edge of edges) {
            const bp = edge.data!.bendPoints;
            expect(Array.isArray(bp)).toBe(true);
            if (Array.isArray(bp)) {
              for (const p of bp) {
                expect(isPoint(p)).toBe(true);
                if (isPoint(p)) {
                  expect(typeof p.x).toBe("number");
                  expect(typeof p.y).toBe("number");
                }
              }
            }
          }
        }),
      );
    });

    it("[prop-style-passthrough] NodeStyle from DiagramSpec appears on RF node.style", () => {
      fc.assert(
        fc.property(arbElkAndSpec, ({ elk, spec }) => {
          const { nodes } = elkToFlow(elk, spec);
          const nodeMap = new Map(nodes.map((n) => [n.id, n]));

          for (const sn of spec.nodes) {
            if (sn.style?.background) {
              const rfNode = nodeMap.get(sn.id);
              expect(rfNode?.style).toBeDefined();
              expect(rfNode!.style?.background).toBe(sn.style.background);
            }
          }
        }),
      );
    });
  });

  describe("example-based", () => {
    it("[e2f-positions] maps ELK positions to RF positions", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 100, y: 200, width: 160, height: 40 },
          { id: "b", x: 300, y: 400, width: 160, height: 40 },
        ],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        groups: [],
      };
      const { nodes } = elkToFlow(elk, spec);

      const a = nodes.find((n) => n.id === "a")!;

      const b = nodes.find((n) => n.id === "b")!;
      expect(a.position).toEqual({ x: 100, y: 200 });
      expect(b.position).toEqual({ x: 300, y: 400 });
    });

    it("[e2f-parent] child positions are passed through (ELK already gives relative coords)", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          {
            id: "g1",
            x: 50,
            y: 50,
            width: 300,
            height: 200,
            children: [{ id: "n1", x: 30, y: 40, width: 160, height: 40 }],
          },
        ],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "n1", label: "N1", parentId: "g1" }],
        edges: [],
        groups: [{ id: "g1", label: "Group 1" }],
      };
      const { nodes } = elkToFlow(elk, spec);

      const n1 = nodes.find((n) => n.id === "n1")!;
      expect(n1.parentId).toBe("g1");
      expect(n1.position).toEqual({ x: 30, y: 40 });
    });

    it("[e2f-bend-points] extracts bend points from ELK sections", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 160, height: 40 },
          { id: "b", x: 300, y: 300, width: 160, height: 40 },
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
                endPoint: { x: 380, y: 300 },
                bendPoints: [
                  { x: 80, y: 170 },
                  { x: 380, y: 170 },
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
        edges: [{ id: "e1", source: "a", target: "b" }],
        groups: [],
      };
      const { edges } = elkToFlow(elk, spec);

      const e1 = edges.find((e) => e.id === "e1")!;
      const rawBp = e1.data!.bendPoints;
      expect(Array.isArray(rawBp)).toBe(true);
      const bp = Array.isArray(rawBp) ? rawBp.filter(isPoint) : [];
      expect(bp).toEqual([
        { x: 80, y: 40 },
        { x: 80, y: 170 },
        { x: 380, y: 170 },
        { x: 380, y: 300 },
      ]);
    });

    it("[e2f-data] DiagramNode.data is passed through to RF node.data", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "a", x: 0, y: 0, width: 160, height: 40 }],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A", data: { gauge: 0.75 } }],
        edges: [],
        groups: [],
      };
      const { nodes } = elkToFlow(elk, spec);

      const a = nodes.find((n) => n.id === "a")!;
      expect(a.data.gauge).toBe(0.75);
    });
  });

  describe("branch coverage", () => {
    it("[e2f-no-edges] handles elkRoot with no edges property", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "a", x: 0, y: 0, width: 160, height: 40 }],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [],
      };
      const { edges } = elkToFlow(elk, spec);
      expect(edges).toEqual([]);
    });

    it("[e2f-no-children] handles elkNode with no children property", () => {
      const elk: ElkNode = { id: "root", edges: [] };
      const spec: DiagramSpec = { nodes: [], edges: [], groups: [] };
      const { nodes } = elkToFlow(elk, spec);
      expect(nodes).toEqual([]);
    });

    it("[e2f-undefined-xy] defaults to 0 when child.x/y are undefined", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "a", width: 160, height: 40 }],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [],
      };
      const { nodes } = elkToFlow(elk, spec);
      expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    });

    it("[e2f-label-fallback] falls back to child.id when no spec node or group", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "orphan", x: 10, y: 20, width: 160, height: 40 }],
        edges: [],
      };
      const spec: DiagramSpec = { nodes: [], edges: [], groups: [] };
      const { nodes } = elkToFlow(elk, spec);
      expect(nodes[0].data.label).toBe("orphan");
    });

    it("[e2f-no-bendpoints] handles edge section with no bendPoints", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 160, height: 40 },
          { id: "b", x: 300, y: 0, width: 160, height: 40 },
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
                endPoint: { x: 380, y: 40 },
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
        edges: [{ id: "e1", source: "a", target: "b" }],
        groups: [],
      };
      const { edges } = elkToFlow(elk, spec);
      const bp = edges[0].data!.bendPoints;
      expect(Array.isArray(bp)).toBe(true);
      expect(bp).toEqual([
        { x: 80, y: 40 },
        { x: 380, y: 40 },
      ]);
    });

    it("[e2f-no-sections] handles edge with no sections", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 160, height: 40 },
          { id: "b", x: 300, y: 0, width: 160, height: 40 },
        ],
        edges: [{ id: "e1", sources: ["a"], targets: ["b"] }],
      };
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }],
        groups: [],
      };
      const { edges } = elkToFlow(elk, spec);
      expect(edges[0].data!.bendPoints).toEqual([]);
    });

    it("[e2f-edge-label] passes edge label from spec to RF edge", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 160, height: 40 },
          { id: "b", x: 300, y: 0, width: 160, height: 40 },
        ],
        edges: [{ id: "e1", sources: ["a"], targets: ["b"] }],
      };
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", label: "connects" }],
        groups: [],
      };
      const { edges } = elkToFlow(elk, spec);
      expect(edges[0].label).toBe("connects");
    });

    it("[e2f-edge-style] applies edge style CSS from spec", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 160, height: 40 },
          { id: "b", x: 300, y: 0, width: 160, height: 40 },
        ],
        edges: [{ id: "e1", sources: ["a"], targets: ["b"] }],
      };
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
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
      const { edges } = elkToFlow(elk, spec);
      expect(edges[0].style).toEqual({ stroke: "#ff0000", strokeWidth: 3 });
    });

    it("[e2f-edge-style-empty] returns undefined style for edge with empty style", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 160, height: 40 },
          { id: "b", x: 300, y: 0, width: 160, height: 40 },
        ],
        edges: [{ id: "e1", sources: ["a"], targets: ["b"] }],
      };
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b", style: {} }],
        groups: [],
      };
      const { edges } = elkToFlow(elk, spec);
      expect(edges[0].style).toBeUndefined();
    });

    it("[e2f-node-no-dimensions] handles node without width/height", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "a", x: 10, y: 20 }],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [],
      };
      const { nodes } = elkToFlow(elk, spec);
      expect(nodes[0].width).toBeUndefined();
      expect(nodes[0].height).toBeUndefined();
    });

    it("[e2f-node-custom-type] passes through custom node type from spec", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "a", x: 0, y: 0, width: 160, height: 40 }],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A", type: "custom" }],
        edges: [],
        groups: [],
      };
      const { nodes } = elkToFlow(elk, spec);
      expect(nodes[0].type).toBe("custom");
    });

    it("[e2f-inline-children] passes inlineChildren from spec to RF node data", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "a", x: 0, y: 0, width: 160, height: 40 }],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [
          {
            id: "a",
            label: "A",
            inlineChildren: [{ id: "b", label: "B" }],
          },
        ],
        edges: [],
        groups: [],
      };
      const { nodes } = elkToFlow(elk, spec);
      expect(nodes[0].data.inlineChildren).toEqual([{ id: "b", label: "B" }]);
    });

    it("[e2f-group-data] DiagramGroup.data is passed through to RF node.data", () => {
      const elk: ElkNode = {
        id: "root",
        children: [
          {
            id: "g1",
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            children: [{ id: "n1", x: 30, y: 40, width: 160, height: 40 }],
          },
        ],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "n1", label: "N1", parentId: "g1" }],
        edges: [],
        groups: [
          {
            id: "g1",
            label: "Group 1",
            data: { className: "MyBlueprint", description: "Does things" },
          },
        ],
      };
      const { nodes } = elkToFlow(elk, spec);
      const g1 = nodes.find((n) => n.id === "g1")!;
      expect(g1.data.description).toBe("Does things");
      expect(g1.data.className).toBe("MyBlueprint");
    });

    it("[e2f-no-inline-children] omits inlineChildren when not present", () => {
      const elk: ElkNode = {
        id: "root",
        children: [{ id: "a", x: 0, y: 0, width: 160, height: 40 }],
        edges: [],
      };
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [],
      };
      const { nodes } = elkToFlow(elk, spec);
      expect(nodes[0].data.inlineChildren).toBeUndefined();
    });
  });
});
