import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { ElkNode } from "elkjs";
import { specToElk } from "./spec-to-elk";
import type {
  DiagramSpec,
  DiagramGroup,
  DiagramNode,
  DiagramEdge,
  LayoutOptions,
} from "./types";

/** Collect all node IDs from an ELK tree (root + nested children). */
function collectElkNodeIds(node: ElkNode): Set<string> {
  const ids = new Set<string>();
  for (const child of node.children ?? []) {
    ids.add(child.id);
    for (const id of collectElkNodeIds(child)) {
      ids.add(id);
    }
  }
  return ids;
}

/** Find an ELK node by id anywhere in the tree. */
function findElkNode(root: ElkNode, id: string): ElkNode | undefined {
  for (const child of root.children ?? []) {
    if (child.id === id) return child;
    const found = findElkNode(child, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * fast-check arbitrary for a valid DiagramSpec.
 * Generates groups, then nodes (some parented to groups), then edges
 * that reference existing node IDs.
 */
const arbDiagramSpec: fc.Arbitrary<DiagramSpec> = fc
  .record({
    groupCount: fc.integer({ min: 0, max: 4 }),
    nodeCount: fc.integer({ min: 1, max: 20 }),
  })
  .chain(({ groupCount, nodeCount }) => {
    const groups: DiagramGroup[] = Array.from(
      { length: groupCount },
      (_, i) => ({
        id: `g${String(i)}`,
        label: `Group ${String(i)}`,
      }),
    );
    const groupIds = groups.map((g) => g.id);

    const arbNode = fc
      .integer({ min: 0, max: nodeCount - 1 })
      .map((idx): DiagramNode => {
        const id = `n${String(idx)}`;
        const parentId =
          groupIds.length > 0 && idx % 3 === 0
            ? groupIds[idx % groupIds.length]
            : undefined;
        return { id, label: `Node ${String(idx)}`, parentId };
      });

    return fc
      .tuple(
        fc.uniqueArray(arbNode, {
          minLength: nodeCount,
          maxLength: nodeCount,
          selector: (n) => n.id,
        }),
        fc.array(
          fc.record({
            sourceIdx: fc.integer({ min: 0, max: nodeCount - 1 }),
            targetIdx: fc.integer({ min: 0, max: nodeCount - 1 }),
          }),
          { minLength: 0, maxLength: nodeCount * 2 },
        ),
      )
      .map(([nodes, edgeDefs]): DiagramSpec => {
        const edges: DiagramEdge[] = edgeDefs
          .filter((e) => e.sourceIdx !== e.targetIdx)
          .map((e, i) => ({
            id: `e${String(i)}`,
            source: `n${String(e.sourceIdx)}`,
            target: `n${String(e.targetIdx)}`,
          }));
        return { nodes, edges, groups };
      });
  });

const arbLayoutOptions: fc.Arbitrary<LayoutOptions> = fc.record({
  direction: fc.constantFrom(
    "DOWN" as const,
    "RIGHT" as const,
    "UP" as const,
    "LEFT" as const,
  ),
  nodeSpacing: fc.integer({ min: 10, max: 200 }),
  layerSpacing: fc.integer({ min: 10, max: 200 }),
  edgeRouting: fc.constantFrom(
    "ORTHOGONAL" as const,
    "POLYLINE" as const,
    "SPLINES" as const,
  ),
});

describe("specToElk", () => {
  describe("fast-check properties", () => {
    it("[prop-node-preservation] every DiagramSpec node appears exactly once in ELK output", () => {
      fc.assert(
        fc.property(arbDiagramSpec, (spec) => {
          const elk = specToElk(spec);
          const elkIds = collectElkNodeIds(elk);
          const specNodeIds = new Set(spec.nodes.map((n) => n.id));
          const specGroupIds = new Set(spec.groups.map((g) => g.id));

          for (const id of specNodeIds) {
            expect(elkIds.has(id)).toBe(true);
          }
          for (const id of specGroupIds) {
            expect(elkIds.has(id)).toBe(true);
          }
        }),
      );
    });

    it("[prop-edge-validity] every ELK edge references IDs that exist in the graph", () => {
      fc.assert(
        fc.property(arbDiagramSpec, (spec) => {
          const elk = specToElk(spec);
          const allIds = collectElkNodeIds(elk);

          for (const edge of elk.edges ?? []) {
            for (const s of (edge as { sources: string[] }).sources) {
              expect(allIds.has(s)).toBe(true);
            }
            for (const t of (edge as { targets: string[] }).targets) {
              expect(allIds.has(t)).toBe(true);
            }
          }
        }),
      );
    });

    it("[prop-compound-nesting] nodes with parentId are nested under the correct group", () => {
      fc.assert(
        fc.property(arbDiagramSpec, (spec) => {
          const elk = specToElk(spec);
          const groupIds = new Set(spec.groups.map((g) => g.id));

          for (const node of spec.nodes) {
            if (node.parentId && groupIds.has(node.parentId)) {
              const parent = findElkNode(elk, node.parentId);
              expect(parent).toBeDefined();

              const childIds = (parent!.children ?? []).map((c) => c.id);
              expect(childIds).toContain(node.id);
            }
          }
        }),
      );
    });

    it("[prop-options-mapping] LayoutOptions fields are reflected in ELK layoutOptions", () => {
      fc.assert(
        fc.property(arbDiagramSpec, arbLayoutOptions, (spec, opts) => {
          const elk = specToElk(spec, opts);

          const lo = elk.layoutOptions!;

          expect(lo["elk.direction"]).toBe(opts.direction);
          expect(lo["elk.spacing.nodeNode"]).toBe(String(opts.nodeSpacing));
          expect(lo["elk.layered.spacing.nodeNodeBetweenLayers"]).toBe(
            String(opts.layerSpacing),
          );
          expect(lo["elk.edgeRouting"]).toBe(opts.edgeRouting);
        }),
      );
    });
  });

  describe("example-based", () => {
    it("[s2e-flat] flat graph with no groups produces a flat ELK structure", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }],
        groups: [],
      };
      const elk = specToElk(spec);

      expect(elk.children).toHaveLength(2);

      expect(elk.children!.map((c) => c.id).sort()).toEqual(["a", "b"]);
      expect(elk.edges).toHaveLength(1);

      expect(elk.layoutOptions!["elk.hierarchyHandling"]).toBeUndefined();
    });

    it("[s2e-compound] groups with children produce compound ELK nodes with INCLUDE_CHILDREN", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "n1", label: "N1", parentId: "g1" },
          { id: "n2", label: "N2" },
        ],
        edges: [],
        groups: [{ id: "g1", label: "Group 1" }],
      };
      const elk = specToElk(spec);

      expect(elk.layoutOptions!["elk.hierarchyHandling"]).toBe(
        "INCLUDE_CHILDREN",
      );

      const g1 = elk.children!.find((c) => c.id === "g1");
      expect(g1).toBeDefined();

      expect(g1!.children!.map((c) => c.id)).toEqual(["n1"]);

      const n2 = elk.children!.find((c) => c.id === "n2");
      expect(n2).toBeDefined();
    });

    it("[s2e-options] default options when nothing is provided", () => {
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [],
      };
      const elk = specToElk(spec);

      const lo = elk.layoutOptions!;

      expect(lo["elk.algorithm"]).toBe("layered");
      expect(lo["elk.direction"]).toBe("DOWN");
      expect(lo["elk.edgeRouting"]).toBe("ORTHOGONAL");
    });
  });

  describe("branch coverage", () => {
    it("[s2e-undefined-opts] uses defaults when opts is undefined", () => {
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [],
      };
      const elk = specToElk(spec, undefined);
      const lo = elk.layoutOptions!;
      expect(lo["elk.direction"]).toBe("DOWN");
      expect(lo["elk.edgeRouting"]).toBe("ORTHOGONAL");
      expect(lo["elk.spacing.nodeNode"]).toBe("40");
      expect(lo["elk.layered.spacing.nodeNodeBetweenLayers"]).toBe("60");
    });

    it("[s2e-empty-group-children] group with no assigned nodes gets empty children array", () => {
      const spec: DiagramSpec = {
        nodes: [{ id: "a", label: "A" }],
        edges: [],
        groups: [{ id: "g1", label: "Empty Group" }],
      };
      const elk = specToElk(spec);
      const g1 = elk.children!.find((c) => c.id === "g1")!;
      expect(g1.children).toEqual([]);
    });

    it("[s2e-node-no-parent] node without parentId goes to root children", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B", parentId: undefined },
        ],
        edges: [],
        groups: [],
      };
      const elk = specToElk(spec);
      const rootIds = elk.children!.map((c) => c.id);
      expect(rootIds).toContain("a");
      expect(rootIds).toContain("b");
    });

    it("[s2e-nested-group] group with parentId is nested inside parent group", () => {
      const spec: DiagramSpec = {
        nodes: [{ id: "n1", label: "N1", parentId: "inner" }],
        edges: [],
        groups: [
          { id: "outer", label: "Outer" },
          { id: "inner", label: "Inner", parentId: "outer" },
        ],
      };
      const elk = specToElk(spec);

      // outer should be a root child
      const outer = elk.children!.find((c) => c.id === "outer");
      expect(outer).toBeDefined();

      // inner should be nested inside outer, not at root
      const rootIds = elk.children!.map((c) => c.id);
      expect(rootIds).not.toContain("inner");

      // inner is a child of outer
      const innerInOuter = outer!.children!.find((c) => c.id === "inner");
      expect(innerInOuter).toBeDefined();

      // n1 is a child of inner
      expect(innerInOuter!.children!.map((c) => c.id)).toContain("n1");
    });

    it("[s2e-generic-default-size] all unmeasured nodes get the same default size regardless of type", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "m1", label: "Metric", type: "metric" },
        ],
        edges: [],
        groups: [],
      };
      const elk = specToElk(spec);

      const regular = elk.children!.find((c) => c.id === "a")!;
      const metric = elk.children!.find((c) => c.id === "m1")!;

      // Both nodes get the same generic default — actual sizes come from
      // the DOM measurement cycle, not per-type fallbacks.
      expect(regular.width).toBe(160);
      expect(regular.height).toBe(40);
      expect(metric.width).toBe(160);
      expect(metric.height).toBe(40);
    });

    it("[s2e-group-no-parent] group without parentId goes to root", () => {
      const spec: DiagramSpec = {
        nodes: [],
        edges: [],
        groups: [{ id: "g1", label: "G1" }],
      };
      const elk = specToElk(spec);
      expect(elk.children!.map((c) => c.id)).toContain("g1");
    });

    it("[s2e-node-sizes] uses provided nodeSizes over defaults", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [],
        groups: [],
      };
      const sizes = {
        a: { width: 200, height: 60 },
        b: { width: 180, height: 50 },
      };
      const elk = specToElk(spec, undefined, sizes);

      const nodeA = elk.children!.find((c) => c.id === "a")!;
      const nodeB = elk.children!.find((c) => c.id === "b")!;

      expect(nodeA.width).toBe(200);
      expect(nodeA.height).toBe(60);
      expect(nodeB.width).toBe(180);
      expect(nodeB.height).toBe(50);
    });

    it("[s2e-synthetic-edges] adds synthetic edges for groups with mixed metric/input edgeless children", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "m1", label: "Metric 1", type: "metric", parentId: "g1" },
          { id: "m2", label: "Metric 2", type: "metric", parentId: "g1" },
          { id: "i1", label: "Input 1", type: "simInput", parentId: "g1" },
          { id: "i2", label: "Input 2", type: "simInput", parentId: "g1" },
        ],
        edges: [],
        groups: [{ id: "g1", label: "Pool" }],
      };
      const elk = specToElk(spec);
      const g1 = elk.children!.find((c) => c.id === "g1")!;

      // Should have synthetic edges from last metric to each input
      expect(g1.edges).toBeDefined();
      expect(g1.edges!.length).toBe(2);

      const edgeTargets = g1
        .edges!.map((e) => (e as { targets: string[] }).targets[0])
        .sort();
      expect(edgeTargets).toEqual(["i1", "i2"]);

      // All synthetic edges originate from the same anchor (last metric)
      const edgeSources = g1.edges!.map(
        (e) => (e as { sources: string[] }).sources[0],
      );
      expect(new Set(edgeSources).size).toBe(1);
      expect(edgeSources[0]).toBe("m2");
    });

    it("[s2e-no-synthetic-edges-single-type] no synthetic edges when only one type present", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "m1", label: "Metric 1", type: "metric", parentId: "g1" },
          { id: "m2", label: "Metric 2", type: "metric", parentId: "g1" },
        ],
        edges: [],
        groups: [{ id: "g1", label: "Pool" }],
      };
      const elk = specToElk(spec);
      const g1 = elk.children!.find((c) => c.id === "g1")!;

      expect(g1.edges).toBeUndefined();
    });

    it("[s2e-no-synthetic-edges-with-inbound] no synthetic edges for children with inbound edges", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "m1", label: "Metric 1", type: "metric", parentId: "g1" },
          { id: "i1", label: "Input 1", type: "simInput", parentId: "g1" },
          { id: "outside", label: "Outside" },
        ],
        edges: [
          // Both children have inbound edges
          { id: "e1", source: "outside", target: "m1" },
          { id: "e2", source: "outside", target: "i1" },
        ],
        groups: [{ id: "g1", label: "Pool" }],
      };
      const elk = specToElk(spec);
      const g1 = elk.children!.find((c) => c.id === "g1")!;

      expect(g1.edges).toBeUndefined();
    });

    it("[s2e-synthetic-edges-partial-inbound] only edgeless children get synthetic edges", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "m1", label: "Metric 1", type: "metric", parentId: "g1" },
          { id: "m2", label: "Metric 2", type: "metric", parentId: "g1" },
          { id: "i1", label: "Input 1", type: "simInput", parentId: "g1" },
          { id: "outside", label: "Outside" },
        ],
        edges: [
          // m1 has an inbound edge, m2 and i1 do not
          { id: "e1", source: "outside", target: "m1" },
        ],
        groups: [{ id: "g1", label: "Pool" }],
      };
      const elk = specToElk(spec);
      const g1 = elk.children!.find((c) => c.id === "g1")!;

      // m2 (edgeless metric) is anchor, i1 (edgeless input) is target
      expect(g1.edges).toBeDefined();
      expect(g1.edges!.length).toBe(1);
      expect((g1.edges![0] as { sources: string[] }).sources[0]).toBe("m2");
      expect((g1.edges![0] as { targets: string[] }).targets[0]).toBe("i1");
    });

    it("[s2e-synthetic-edges-preserve-real] real edges are preserved alongside synthetic edges", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "m1", label: "Metric 1", type: "metric", parentId: "g1" },
          { id: "i1", label: "Input 1", type: "simInput", parentId: "g1" },
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }],
        groups: [{ id: "g1", label: "Pool" }],
      };
      const elk = specToElk(spec);

      // Real edge on root
      expect(elk.edges).toHaveLength(1);
      expect(elk.edges![0].id).toBe("e1");

      // Synthetic edge on group
      const g1 = elk.children!.find((c) => c.id === "g1")!;
      expect(g1.edges).toBeDefined();
      expect(g1.edges!.length).toBe(1);
    });

    it("[s2e-no-synthetic-untyped] children without a recognized type are ignored", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "m1", label: "Metric 1", type: "metric", parentId: "g1" },
          { id: "x1", label: "Other", type: "default", parentId: "g1" },
        ],
        edges: [],
        groups: [{ id: "g1", label: "Pool" }],
      };
      const elk = specToElk(spec);
      const g1 = elk.children!.find((c) => c.id === "g1")!;

      // "default" is not in ROW_ORDER, so no synthetic edges
      expect(g1.edges).toBeUndefined();
    });

    it("[s2e-node-sizes-partial] falls back to type average for unmeasured nodes of same type", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "m1", label: "Metric 1", type: "metric" },
          { id: "m2", label: "Metric 2", type: "metric" },
        ],
        edges: [],
        groups: [],
      };
      const sizes = {
        a: { width: 200, height: 60 },
        m1: { width: 220, height: 100 },
      };
      const elk = specToElk(spec, undefined, sizes);

      const nodeA = elk.children!.find((c) => c.id === "a")!;
      const m1 = elk.children!.find((c) => c.id === "m1")!;
      const m2 = elk.children!.find((c) => c.id === "m2")!;

      expect(nodeA.width).toBe(200);
      expect(nodeA.height).toBe(60);
      expect(m1.width).toBe(220);
      expect(m1.height).toBe(100);
      // Unmeasured metric node uses the measured size of the other metric node
      expect(m2.width).toBe(220);
      expect(m2.height).toBe(100);
    });

    it("[s2e-node-sizes-no-type-match] falls back to defaults when no type match", () => {
      const spec: DiagramSpec = {
        nodes: [
          { id: "a", label: "A" },
          { id: "m1", label: "Metric", type: "metric" },
        ],
        edges: [],
        groups: [],
      };
      const sizes = {
        a: { width: 200, height: 60 },
      };
      const elk = specToElk(spec, undefined, sizes);

      const metric = elk.children!.find((c) => c.id === "m1")!;

      // No other measured metric nodes → generic default
      expect(metric.width).toBe(160);
      expect(metric.height).toBe(40);
    });
  });
});
