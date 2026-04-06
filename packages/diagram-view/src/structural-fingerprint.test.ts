import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { structuralFingerprint } from "./structural-fingerprint";
import type {
  DiagramSpec,
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
  NodeStyle,
} from "./types";

const arbNodeStyle: fc.Arbitrary<NodeStyle> = fc.record({
  background: fc.option(fc.constant("#ff0000"), { nil: undefined }),
  borderColor: fc.option(fc.constant("#00ff00"), { nil: undefined }),
  opacity: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
    nil: undefined,
  }),
});

const arbDiagramSpec: fc.Arbitrary<DiagramSpec> = fc
  .record({
    groupCount: fc.integer({ min: 0, max: 3 }),
    nodeCount: fc.integer({ min: 1, max: 15 }),
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

    return fc
      .tuple(
        fc.array(
          fc.record({
            style: arbNodeStyle,
            label: fc.string({ minLength: 1, maxLength: 10 }),
            data: fc.dictionary(
              fc.string({ minLength: 1, maxLength: 5 }),
              fc.integer(),
            ),
          }),
          { minLength: nodeCount, maxLength: nodeCount },
        ),
        fc.array(
          fc.record({
            sourceIdx: fc.integer({ min: 0, max: nodeCount - 1 }),
            targetIdx: fc.integer({ min: 0, max: nodeCount - 1 }),
          }),
          { minLength: 0, maxLength: nodeCount },
        ),
      )
      .map(([nodeDefs, edgeDefs]): DiagramSpec => {
        const nodes: DiagramNode[] = nodeDefs.map((def, i) => ({
          id: `n${String(i)}`,
          label: def.label,
          parentId:
            groupIds.length > 0 && i % 3 === 0
              ? groupIds[i % groupIds.length]
              : undefined,
          style: def.style,
          data: def.data,
        }));
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

describe("structuralFingerprint", () => {
  it("[prop-style-invariant] changing only style/data/label does not change fingerprint", () => {
    fc.assert(
      fc.property(
        arbDiagramSpec,
        arbNodeStyle,
        fc.string(),
        (spec, newStyle, newLabel) => {
          const modified: DiagramSpec = {
            ...spec,
            nodes: spec.nodes.map((n) => ({
              ...n,
              style: newStyle,
              label: newLabel,
              data: { changed: true },
            })),
          };
          expect(structuralFingerprint(spec)).toBe(
            structuralFingerprint(modified),
          );
        },
      ),
    );
  });

  it("[prop-structural-sensitive] adding a node changes the fingerprint", () => {
    fc.assert(
      fc.property(arbDiagramSpec, (spec) => {
        const extra: DiagramNode = {
          id: `n_extra_${String(spec.nodes.length)}`,
          label: "Extra",
        };
        const modified: DiagramSpec = {
          ...spec,
          nodes: [...spec.nodes, extra],
        };
        expect(structuralFingerprint(spec)).not.toBe(
          structuralFingerprint(modified),
        );
      }),
    );
  });

  it("[prop-structural-sensitive] changing an edge target changes the fingerprint", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
      groups: [],
    };
    const modified: DiagramSpec = {
      ...spec,
      edges: [{ id: "e1", source: "a", target: "c" }],
    };
    expect(structuralFingerprint(spec)).not.toBe(
      structuralFingerprint(modified),
    );
  });

  it("[prop-structural-sensitive] changing parentId changes the fingerprint", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "n1", label: "N1", parentId: "g1" }],
      edges: [],
      groups: [{ id: "g1", label: "G1" }],
    };
    const modified: DiagramSpec = {
      ...spec,
      nodes: [{ id: "n1", label: "N1" }],
    };
    expect(structuralFingerprint(spec)).not.toBe(
      structuralFingerprint(modified),
    );
  });

  it("[prop-structural-sensitive] changing group parentId changes the fingerprint", () => {
    const spec: DiagramSpec = {
      nodes: [],
      edges: [],
      groups: [
        { id: "outer", label: "Outer" },
        { id: "inner", label: "Inner" },
      ],
    };
    const modified: DiagramSpec = {
      ...spec,
      groups: [
        { id: "outer", label: "Outer" },
        { id: "inner", label: "Inner", parentId: "outer" },
      ],
    };
    expect(structuralFingerprint(spec)).not.toBe(
      structuralFingerprint(modified),
    );
  });
});
