import { describe, it, expect } from "vitest";
import type { DiagramSpec } from "@diagram/diagram-view";
import type { StyleRuleDescriptor } from "@diagram/sim-model";
import type { NodeContext } from "@diagram/sim-model";
import {
  buildTopologyIndex,
  matchNumericCond,
  isNumericCond,
  matchTopologyCond,
  matchObjectCondition,
  resolveStyleRules,
  resolveDisplayModes,
  applyDisplayTransforms,
  type TopoEntry,
} from "./resolve-styles";

// ---------------------------------------------------------------------------
// buildTopologyIndex
// ---------------------------------------------------------------------------

describe("buildTopologyIndex", () => {
  it("computes in/out degrees", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
      groups: [],
    };
    const idx = buildTopologyIndex(spec);
    expect(idx.get("a")).toMatchObject({ outDegree: 1, inDegree: 0 });
    expect(idx.get("b")).toMatchObject({ inDegree: 1, outDegree: 0 });
  });

  it("marks groups as isGroup", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "c", label: "C", parentId: "g1" }],
      edges: [],
      groups: [{ id: "g1", label: "G1" }],
    };
    const idx = buildTopologyIndex(spec);
    expect(idx.get("g1")!.isGroup).toBe(true);
    expect(idx.get("c")!.hasParent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchNumericCond
// ---------------------------------------------------------------------------

describe("matchNumericCond", () => {
  it("gt: true when value > threshold", () => {
    expect(matchNumericCond(10, { gt: 5 })).toBe(true);
    expect(matchNumericCond(5, { gt: 5 })).toBe(false);
  });

  it("gte: true when value >= threshold", () => {
    expect(matchNumericCond(5, { gte: 5 })).toBe(true);
    expect(matchNumericCond(4, { gte: 5 })).toBe(false);
  });

  it("lt: true when value < threshold", () => {
    expect(matchNumericCond(3, { lt: 5 })).toBe(true);
    expect(matchNumericCond(5, { lt: 5 })).toBe(false);
  });

  it("lte: true when value <= threshold", () => {
    expect(matchNumericCond(5, { lte: 5 })).toBe(true);
    expect(matchNumericCond(6, { lte: 5 })).toBe(false);
  });

  it("eq: true when value === threshold", () => {
    expect(matchNumericCond(5, { eq: 5 })).toBe(true);
    expect(matchNumericCond(4, { eq: 5 })).toBe(false);
  });

  it("combines multiple conditions (AND)", () => {
    expect(matchNumericCond(5, { gte: 3, lte: 7 })).toBe(true);
    expect(matchNumericCond(2, { gte: 3, lte: 7 })).toBe(false);
    expect(matchNumericCond(8, { gte: 3, lte: 7 })).toBe(false);
  });

  it("returns true for empty condition", () => {
    expect(matchNumericCond(42, {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isNumericCond
// ---------------------------------------------------------------------------

describe("isNumericCond", () => {
  it("recognizes valid numeric conditions", () => {
    expect(isNumericCond({ gt: 5 })).toBe(true);
    expect(isNumericCond({ gte: 1, lte: 10 })).toBe(true);
    expect(isNumericCond({ eq: 0 })).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isNumericCond(null)).toBe(false);
    expect(isNumericCond(42)).toBe(false);
    expect(isNumericCond("string")).toBe(false);
  });

  it("rejects empty objects", () => {
    expect(isNumericCond({})).toBe(false);
  });

  it("rejects objects with unknown keys", () => {
    expect(isNumericCond({ gt: 5, unknown: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchTopologyCond
// ---------------------------------------------------------------------------

describe("matchTopologyCond", () => {
  const baseTopo: TopoEntry = {
    inDegree: 2,
    outDegree: 3,
    isGroup: false,
    hasParent: true,
  };

  it("matches exact inDegree", () => {
    expect(matchTopologyCond(baseTopo, { inDegree: 2 })).toBe(true);
    expect(matchTopologyCond(baseTopo, { inDegree: 0 })).toBe(false);
  });

  it("matches numeric condition on outDegree", () => {
    expect(matchTopologyCond(baseTopo, { outDegree: { gt: 1 } })).toBe(true);
    expect(matchTopologyCond(baseTopo, { outDegree: { gt: 5 } })).toBe(false);
  });

  it("matches isGroup and hasParent booleans", () => {
    expect(matchTopologyCond(baseTopo, { isGroup: false })).toBe(true);
    expect(matchTopologyCond(baseTopo, { isGroup: true })).toBe(false);
    expect(matchTopologyCond(baseTopo, { hasParent: true })).toBe(true);
  });

  it("empty condition matches everything", () => {
    expect(matchTopologyCond(baseTopo, {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchCondition
// ---------------------------------------------------------------------------

describe("matchCondition (object form)", () => {
  const baseCtx: NodeContext = {
    id: "node-1",
    type: "default",
    data: { latency: 200, status: "ok" },
    topology: { inDegree: 1, outDegree: 2, isGroup: false, hasParent: false },
    metric: () => undefined,
  };

  it("matches by type", () => {
    expect(matchObjectCondition(baseCtx, { type: "default" })).toBe(true);
    expect(matchObjectCondition(baseCtx, { type: "group" })).toBe(false);
  });

  it("matches by id", () => {
    expect(matchObjectCondition(baseCtx, { id: "node-1" })).toBe(true);
    expect(matchObjectCondition(baseCtx, { id: "other" })).toBe(false);
  });

  it("matches data with numeric condition", () => {
    expect(
      matchObjectCondition(baseCtx, { data: { latency: { gt: 100 } } }),
    ).toBe(true);
    expect(
      matchObjectCondition(baseCtx, { data: { latency: { lt: 100 } } }),
    ).toBe(false);
  });

  it("matches data with direct equality", () => {
    expect(matchObjectCondition(baseCtx, { data: { status: "ok" } })).toBe(
      true,
    );
    expect(matchObjectCondition(baseCtx, { data: { status: "error" } })).toBe(
      false,
    );
  });

  it("rejects data match when field is not a number for numeric condition", () => {
    expect(matchObjectCondition(baseCtx, { data: { status: { gt: 0 } } })).toBe(
      false,
    );
  });

  it("matches topology condition", () => {
    expect(
      matchObjectCondition(baseCtx, {
        topology: { inDegree: 1, outDegree: 2 },
      }),
    ).toBe(true);
  });

  it("empty match matches everything", () => {
    expect(matchObjectCondition(baseCtx, {})).toBe(true);
  });

  it("AND semantics: all conditions must match", () => {
    expect(
      matchObjectCondition(baseCtx, {
        type: "default",
        data: { latency: { gt: 100 } },
      }),
    ).toBe(true);
    expect(
      matchObjectCondition(baseCtx, {
        type: "group",
        data: { latency: { gt: 100 } },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveStyleRules (integration)
// ---------------------------------------------------------------------------

describe("resolveStyleRules", () => {
  const spec: DiagramSpec = {
    nodes: [
      { id: "a", label: "A", data: { latency: 50 } },
      { id: "b", label: "B", data: { latency: 200 } },
      { id: "c", label: "C", parentId: "g1" },
    ],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "a", target: "c" },
    ],
    groups: [{ id: "g1", label: "Group" }],
  };

  it("returns spec unchanged when no rules", () => {
    expect(resolveStyleRules(spec, [])).toBe(spec);
  });

  it("applies style to matching nodes", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: { data: { latency: { gt: 100 } } },
        style: { background: "#ff0000" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    expect(result.nodes.find((n) => n.id === "b")!.style).toEqual({
      background: "#ff0000",
    });
    expect(result.nodes.find((n) => n.id === "a")!.style).toBeUndefined();
  });

  it("applies topology-based rules", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: { topology: { inDegree: 0 } },
        style: { background: "green" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    // "a" is a source node (inDegree 0)
    expect(result.nodes.find((n) => n.id === "a")!.style).toEqual({
      background: "green",
    });
  });

  it("applies rules to groups", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: { topology: { isGroup: true } },
        style: { borderColor: "#3498db" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    expect(result.groups[0].style).toEqual({ borderColor: "#3498db" });
  });

  it("respects priority ordering (higher wins)", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        priority: 10,
        match: {},
        style: { background: "high" },
      },
      {
        priority: 1,
        match: {},
        style: { background: "low", borderColor: "kept" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    const style = result.nodes.find((n) => n.id === "a")!.style;
    expect(style).toEqual({ background: "high", borderColor: "kept" });
  });

  it("merges with existing node styles", () => {
    const specWithStyle: DiagramSpec = {
      ...spec,
      nodes: [
        {
          id: "a",
          label: "A",
          style: { background: "#111", borderColor: "#222" },
        },
      ],
    };
    const rules: StyleRuleDescriptor[] = [
      { match: {}, style: { background: "#999" } },
    ];
    const result = resolveStyleRules(specWithStyle, rules);
    expect(result.nodes[0].style).toEqual({
      background: "#999",
      borderColor: "#222",
    });
  });

  it("propagates shape through style rules", () => {
    const shapeSpec: DiagramSpec = {
      nodes: [{ id: "db", label: "DB" }],
      edges: [],
      groups: [],
    };
    const rules: StyleRuleDescriptor[] = [
      { match: { id: "db" }, style: { shape: "cylinder" } },
    ];
    const result = resolveStyleRules(shapeSpec, rules);
    expect(result.nodes.find((n) => n.id === "db")!.style).toEqual(
      expect.objectContaining({ shape: "cylinder" }),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveDisplayModes
// ---------------------------------------------------------------------------

describe("resolveDisplayModes", () => {
  const spec: DiagramSpec = {
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    edges: [{ id: "e1", source: "a", target: "b" }],
    groups: [],
  };

  it("returns empty map when no rules", () => {
    expect(resolveDisplayModes(spec, []).size).toBe(0);
  });

  it("returns empty map when no display rules", () => {
    const rules: StyleRuleDescriptor[] = [
      { match: {}, style: { background: "red" } },
    ];
    expect(resolveDisplayModes(spec, rules).size).toBe(0);
  });

  it("resolves display mode for matched nodes", () => {
    const rules: StyleRuleDescriptor[] = [
      { match: { id: "b" }, style: { display: "hidden" } },
    ];
    const modes = resolveDisplayModes(spec, rules);
    expect(modes.get("b")).toEqual({ display: "hidden" });
    expect(modes.has("a")).toBe(false);
  });

  it("higher priority wins", () => {
    const rules: StyleRuleDescriptor[] = [
      { priority: 1, match: { id: "b" }, style: { display: "hidden" } },
      { priority: 10, match: { id: "b" }, style: { display: "inline" } },
    ];
    const modes = resolveDisplayModes(spec, rules);
    expect(modes.get("b")?.display).toBe("inline");
  });
});

// ---------------------------------------------------------------------------
// applyDisplayTransforms
// ---------------------------------------------------------------------------

describe("applyDisplayTransforms", () => {
  it("returns spec unchanged when no display modes", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      groups: [],
    };
    expect(applyDisplayTransforms(spec, new Map())).toBe(spec);
  });

  it("hidden: removes node and its edges", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
        { id: "e3", source: "a", target: "c" },
      ],
      groups: [],
    };
    const modes = new Map([["b", { display: "hidden" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    expect(result.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(result.edges).toEqual([{ id: "e3", source: "a", target: "c" }]);
  });

  it("group-child: reparents node into referencing node", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
      groups: [],
    };
    const modes = new Map([["b", { display: "group-child" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    // "a" should have been promoted to a group
    expect(result.groups.map((g) => g.id)).toContain("a");
    // "b" should be a child of "a"
    const bNode = result.nodes.find((n) => n.id === "b");
    expect(bNode?.parentId).toBe("a");
    // Edge should be removed (now implicit)
    expect(result.edges).toEqual([]);
  });

  it("group-child: skips when multiple refs and no groupInto", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { id: "e1", source: "a", target: "c" },
        { id: "e2", source: "b", target: "c" },
      ],
      groups: [],
    };
    const modes = new Map([["c", { display: "group-child" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    // "c" should remain a top-level node (ambiguous ownership)
    const cNode = result.nodes.find((n) => n.id === "c");
    expect(cNode?.parentId).toBeUndefined();
  });

  it("group-child: explicit groupInto resolves ambiguity", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { id: "e1", source: "a", target: "c" },
        { id: "e2", source: "b", target: "c" },
      ],
      groups: [],
    };
    const modes = new Map([
      ["c", { display: "group-child" as const, groupInto: "a" }],
    ]);
    const result = applyDisplayTransforms(spec, modes);

    const cNode = result.nodes.find((n) => n.id === "c");
    expect(cNode?.parentId).toBe("a");
    expect(result.groups.map((g) => g.id)).toContain("a");
  });

  it("inline: collapses node into referencing node as text", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
      groups: [],
    };
    const modes = new Map([["b", { display: "inline" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    // "b" should be removed
    expect(result.nodes.map((n) => n.id)).toEqual(["a"]);
    // "a" should have inlineChildren
    const aNode = result.nodes.find((n) => n.id === "a");
    expect(aNode?.inlineChildren).toEqual([{ id: "b", label: "B" }]);
    // Edge should be removed
    expect(result.edges).toEqual([]);
  });

  it("inline: skips when multiple refs and no groupInto", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { id: "e1", source: "a", target: "c" },
        { id: "e2", source: "b", target: "c" },
      ],
      groups: [],
    };
    const modes = new Map([["c", { display: "inline" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    // "c" should remain (ambiguous)
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("group-child into existing group does not duplicate group", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "child", label: "Child" },
        { id: "metric", label: "M", parentId: "grp" },
      ],
      edges: [{ id: "e1", source: "grp", target: "child" }],
      groups: [{ id: "grp", label: "Group" }],
    };
    const modes = new Map([["child", { display: "group-child" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    expect(result.groups).toHaveLength(1);
    const childNode = result.nodes.find((n) => n.id === "child");
    expect(childNode?.parentId).toBe("grp");
  });

  it("group-child: reparents a group (not just a node) into another group", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "metric", label: "M", parentId: "inner" }],
      edges: [{ id: "e1", source: "outer", target: "inner" }],
      groups: [
        { id: "outer", label: "Outer" },
        { id: "inner", label: "Inner" },
      ],
    };
    const modes = new Map([["inner", { display: "group-child" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    // inner should be nested inside outer via parentId
    const innerGroup = result.groups.find((g) => g.id === "inner");
    expect(innerGroup?.parentId).toBe("outer");
    // Edge should be removed (now implicit)
    expect(result.edges).toEqual([]);
  });

  it("hidden: removes group and clears orphaned children parentId", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "child1", label: "C1", parentId: "grp" },
        { id: "child2", label: "C2", parentId: "grp" },
        { id: "ext", label: "External" },
      ],
      edges: [{ id: "e1", source: "ext", target: "grp" }],
      groups: [{ id: "grp", label: "Group" }],
    };
    const modes = new Map([["grp", { display: "hidden" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    // Group should be removed
    expect(result.groups).toHaveLength(0);
    // Edge should be removed
    expect(result.edges).toEqual([]);
    // Children should have parentId cleared (no orphans)
    for (const node of result.nodes) {
      expect(node.parentId).toBeUndefined();
    }
  });

  it("inline into a group falls back to group-child", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "child", label: "Child", parentId: "grp" },
        { id: "target", label: "Target" },
      ],
      edges: [{ id: "e1", source: "grp", target: "target" }],
      groups: [{ id: "grp", label: "Group" }],
    };
    const modes = new Map([["target", { display: "inline" as const }]]);
    const result = applyDisplayTransforms(spec, modes);

    // target should be reparented as a group-child (not inlined, since owner is a group)
    const targetNode = result.nodes.find((n) => n.id === "target");
    expect(targetNode?.parentId).toBe("grp");
    // No inlineChildren (groups can't hold them)
    expect(targetNode?.inlineChildren).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveStyleRules: display/groupInto stripped from visual styles
// ---------------------------------------------------------------------------

describe("resolveStyleRules display field stripping", () => {
  it("does not leak display or groupInto into resolved node styles", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      groups: [],
    };
    const rules: StyleRuleDescriptor[] = [
      {
        match: { id: "a" },
        style: { background: "#ff0000", display: "hidden", groupInto: "x" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    const style = result.nodes[0].style;
    expect(style).toBeDefined();
    expect(style!.background).toBe("#ff0000");
    expect("display" in style!).toBe(false);
    expect("groupInto" in style!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Function predicates
// ---------------------------------------------------------------------------

describe("function match predicates", () => {
  const spec: DiagramSpec = {
    nodes: [
      { id: "a", label: "A", type: "default", data: { latency: 200 } },
      { id: "b", label: "B", type: "default", data: { latency: 50 } },
    ],
    edges: [{ id: "e1", source: "a", target: "b" }],
    groups: [],
  };

  it("selects nodes using a function predicate", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node) => node.data.latency === 200,
        style: { background: "red" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    expect(result.nodes.find((n) => n.id === "a")?.style?.background).toBe(
      "red",
    );
    expect(
      result.nodes.find((n) => n.id === "b")?.style?.background,
    ).toBeUndefined();
  });

  it("receives correct NodeContext fields", () => {
    let capturedCtx: NodeContext | null = null;
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node) => {
          if (node.id === "a") capturedCtx = node;
          return false;
        },
        style: { background: "x" },
      },
    ];
    resolveStyleRules(spec, rules);
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.id).toBe("a");
    expect(capturedCtx!.type).toBe("default");
    expect(capturedCtx!.data).toEqual({ latency: 200 });
    expect(capturedCtx!.topology.outDegree).toBe(1);
    expect(capturedCtx!.topology.inDegree).toBe(0);
  });

  it("supports OR logic via ||", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node) =>
          node.topology.inDegree === 0 || node.topology.outDegree === 0,
        style: { borderWidth: 2 },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    // Both a (inDegree=0) and b (outDegree=0) match
    expect(result.nodes.find((n) => n.id === "a")?.style?.borderWidth).toBe(2);
    expect(result.nodes.find((n) => n.id === "b")?.style?.borderWidth).toBe(2);
  });
});

describe("function style", () => {
  const spec: DiagramSpec = {
    nodes: [
      { id: "a", label: "A", data: { heat: 0.8 } },
      { id: "b", label: "B", data: { heat: 0.2 } },
    ],
    edges: [],
    groups: [],
  };

  it("computes visual properties from node data", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: {},
        style: (node) => ({
          opacity: Number(node.data.heat),
        }),
      },
    ];
    const result = resolveStyleRules(spec, rules);
    expect(result.nodes.find((n) => n.id === "a")?.style?.opacity).toBe(0.8);
    expect(result.nodes.find((n) => n.id === "b")?.style?.opacity).toBe(0.2);
  });

  it("function style returning display triggers topology transform", () => {
    const spec2: DiagramSpec = {
      nodes: [
        { id: "owner", label: "Owner" },
        { id: "child", label: "Child" },
      ],
      edges: [{ id: "e", source: "owner", target: "child" }],
      groups: [],
    };
    const rules: StyleRuleDescriptor[] = [
      {
        match: { id: "child" },
        style: () => ({ display: "hidden" }),
      },
    ];
    const displayModes = resolveDisplayModes(spec2, rules);
    expect(displayModes.get("child")?.display).toBe("hidden");
  });
});

describe("graph context: referrers and targets", () => {
  const spec: DiagramSpec = {
    nodes: [
      { id: "a", label: "A", data: { status: "error" } },
      { id: "b", label: "B", data: {} },
      { id: "c", label: "C", data: {} },
    ],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ],
    groups: [],
  };

  it("graph.referrers returns nodes with edges pointing to this node", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node, graph) =>
          graph.referrers(node).some((r) => r.data.status === "error"),
        style: { borderColor: "red" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    // b is referred to by a (which has status=error)
    expect(result.nodes.find((n) => n.id === "b")?.style?.borderColor).toBe(
      "red",
    );
    // c is referred to by b (no error status)
    expect(
      result.nodes.find((n) => n.id === "c")?.style?.borderColor,
    ).toBeUndefined();
    // a has no referrers
    expect(
      result.nodes.find((n) => n.id === "a")?.style?.borderColor,
    ).toBeUndefined();
  });

  it("graph.targets returns nodes this node points to", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node, graph) => graph.targets(node).length > 0,
        style: { background: "blue" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    expect(result.nodes.find((n) => n.id === "a")?.style?.background).toBe(
      "blue",
    );
    expect(result.nodes.find((n) => n.id === "b")?.style?.background).toBe(
      "blue",
    );
    // c has no targets
    expect(
      result.nodes.find((n) => n.id === "c")?.style?.background,
    ).toBeUndefined();
  });
});

describe("graph context: rank and metrics", () => {
  const spec: DiagramSpec = {
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    edges: [],
    groups: [],
  };

  const metricsIndex: Map<string, Map<string, number>> = new Map([
    ["a", new Map([["util", 0.9]])],
    ["b", new Map([["util", 0.3]])],
    ["c", new Map([["util", 0.7]])],
  ]);

  it("node.metric returns value from metrics index", () => {
    let capturedValue: number | undefined;
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node) => {
          if (node.id === "a") capturedValue = node.metric("util");
          return false;
        },
        style: { background: "x" },
      },
    ];
    resolveStyleRules(spec, rules, metricsIndex);
    expect(capturedValue).toBe(0.9);
  });

  it("node.metric returns undefined for missing metric", () => {
    let capturedValue: number | undefined = 999;
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node) => {
          if (node.id === "a") capturedValue = node.metric("nonexistent");
          return false;
        },
        style: { background: "x" },
      },
    ];
    resolveStyleRules(spec, rules, metricsIndex);
    expect(capturedValue).toBeUndefined();
  });

  it("graph.rank returns 1-based rank (highest = 1)", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node, graph) => graph.rank(node, "util") === 1,
        style: { background: "gold" },
      },
    ];
    const result = resolveStyleRules(spec, rules, metricsIndex);
    // a has highest util (0.9) → rank 1
    expect(result.nodes.find((n) => n.id === "a")?.style?.background).toBe(
      "gold",
    );
    expect(
      result.nodes.find((n) => n.id === "b")?.style?.background,
    ).toBeUndefined();
    expect(
      result.nodes.find((n) => n.id === "c")?.style?.background,
    ).toBeUndefined();
  });

  it("graph.rank returns 0 for nodes without the metric", () => {
    let capturedRank: number | undefined;
    const sparseMetrics: Map<string, Map<string, number>> = new Map([
      ["a", new Map([["util", 0.5]])],
    ]);
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node, graph) => {
          if (node.id === "b") capturedRank = graph.rank(node, "util");
          return false;
        },
        style: { background: "x" },
      },
    ];
    resolveStyleRules(spec, rules, sparseMetrics);
    expect(capturedRank).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// data.className matching & default style rules
// ---------------------------------------------------------------------------

describe("data.className matching", () => {
  it("matches nodes via data.className", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "p1", label: "Pool 1", data: { className: "Pool" } },
        { id: "db1", label: "DB 1", data: { className: "Database" } },
      ],
      edges: [],
      groups: [],
    };
    const rules: StyleRuleDescriptor[] = [
      {
        match: { data: { className: "Pool" } },
        style: { background: "#00ff00" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    expect(result.nodes.find((n) => n.id === "p1")!.style).toEqual({
      background: "#00ff00",
    });
    expect(result.nodes.find((n) => n.id === "db1")!.style).toBeUndefined();
  });

  it("matches groups via data.className", () => {
    const spec: DiagramSpec = {
      nodes: [],
      edges: [],
      groups: [
        { id: "g1", label: "Service A", data: { className: "ServiceGroup" } },
        { id: "g2", label: "Service B", data: { className: "Other" } },
      ],
    };
    const rules: StyleRuleDescriptor[] = [
      {
        match: { data: { className: "ServiceGroup" } },
        style: { borderColor: "blue" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    expect(result.groups.find((g) => g.id === "g1")!.style).toEqual({
      borderColor: "blue",
    });
    expect(result.groups.find((g) => g.id === "g2")!.style).toBeUndefined();
  });
});

describe("default style rules priority", () => {
  it("low-priority default rules are overridden by higher-priority user rules", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "a", label: "A", data: { className: "Pool" } }],
      edges: [],
      groups: [],
    };
    // Default rule at very low priority (simulating -1e9 offset)
    const defaultRule: StyleRuleDescriptor = {
      priority: -1e9,
      match: { data: { className: "Pool" } },
      style: { background: "default-green", borderColor: "default-border" },
    };
    // User rule at normal priority
    const userRule: StyleRuleDescriptor = {
      priority: 0,
      match: { data: { className: "Pool" } },
      style: { background: "user-red" },
    };
    const result = resolveStyleRules(spec, [defaultRule, userRule]);
    const style = result.nodes[0].style!;
    // User rule wins for background
    expect(style.background).toBe("user-red");
    // Default borderColor still present (user didn't override it)
    expect(style.borderColor).toBe("default-border");
  });

  it("non-empty default rules apply when zero user rules are present", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "a", label: "A", data: { className: "Pool" } }],
      edges: [],
      groups: [],
    };
    // Only default rules, no user rules — the combined array is non-empty
    const defaultRules: StyleRuleDescriptor[] = [
      {
        priority: -1e9,
        match: { data: { className: "Pool" } },
        style: { background: "default-green" },
      },
    ];
    const result = resolveStyleRules(spec, defaultRules);
    expect(result.nodes[0].style).toEqual({ background: "default-green" });
  });
});

describe("mixed declarative and function rules", () => {
  const spec: DiagramSpec = {
    nodes: [{ id: "a", label: "A", data: { x: 10 } }],
    edges: [],
    groups: [],
  };

  it("function and declarative rules interact via priority", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        priority: 1,
        match: {},
        style: { background: "low", borderColor: "kept" },
      },
      {
        priority: 10,
        match: (node) => Number(node.data.x) > 5,
        style: { background: "high" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    const style = result.nodes[0].style!;
    expect(style.background).toBe("high");
    expect(style.borderColor).toBe("kept");
  });
});

describe("error handling for throwing predicates", () => {
  const spec: DiagramSpec = {
    nodes: [{ id: "a", label: "A" }],
    edges: [],
    groups: [],
  };

  it("throwing match predicate is treated as no-match", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: () => {
          throw new Error("boom");
        },
        style: { background: "red" },
      },
      {
        match: {},
        style: { background: "blue" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    // The throwing rule is skipped; the second rule applies
    expect(result.nodes[0].style?.background).toBe("blue");
  });

  it("throwing style function is treated as no-style", () => {
    const rules: StyleRuleDescriptor[] = [
      {
        match: {},
        style: (): never => {
          throw new Error("boom");
        },
      },
      {
        match: {},
        style: { borderColor: "green" },
      },
    ];
    const result = resolveStyleRules(spec, rules);
    // The throwing style is skipped; the second rule applies
    expect(result.nodes[0].style?.borderColor).toBe("green");
    // No background from the throwing rule
    expect(result.nodes[0].style?.background).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// graph.all()
// ---------------------------------------------------------------------------

describe("graph.all", () => {
  it("returns all nodes in the graph", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [],
      groups: [],
    };
    let allIds: string[] = [];
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node, graph) => {
          if (node.id === "a") allIds = graph.all().map((n) => n.id);
          return false;
        },
        style: { background: "x" },
      },
    ];
    resolveStyleRules(spec, rules);
    expect(allIds.sort()).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// rank with tied values
// ---------------------------------------------------------------------------

describe("graph.rank with ties", () => {
  it("assigns distinct ranks to tied values (dense ranking)", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [],
      groups: [],
    };
    const metricsIndex: Map<string, Map<string, number>> = new Map([
      ["a", new Map([["util", 0.5]])],
      ["b", new Map([["util", 0.5]])],
      ["c", new Map([["util", 0.3]])],
    ]);
    const ranks: Record<string, number> = {};
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node, graph) => {
          ranks[node.id] = graph.rank(node, "util");
          return false;
        },
        style: { background: "x" },
      },
    ];
    resolveStyleRules(spec, rules, metricsIndex);
    // a and b are tied at 0.5 — they get ranks 1 and 2 (not both 1)
    expect(new Set([ranks["a"], ranks["b"]])).toEqual(new Set([1, 2]));
    expect(ranks["c"]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// function predicate in resolveDisplayModes
// ---------------------------------------------------------------------------

describe("resolveDisplayModes with function predicates", () => {
  it("function match predicate triggers display mode", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "owner", label: "Owner" },
        { id: "child", label: "Child", data: { hidden: true } },
      ],
      edges: [{ id: "e", source: "owner", target: "child" }],
      groups: [],
    };
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node) => node.data.hidden === true,
        style: { display: "hidden" },
      },
    ];
    const displayModes = resolveDisplayModes(spec, rules);
    expect(displayModes.get("child")?.display).toBe("hidden");
    expect(displayModes.has("owner")).toBe(false);
  });

  it("function match with graph context in display mode resolution", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "source", label: "Source" },
        { id: "target", label: "Target" },
      ],
      edges: [{ id: "e", source: "source", target: "target" }],
      groups: [],
    };
    const rules: StyleRuleDescriptor[] = [
      {
        match: (node, graph) => graph.referrers(node).length === 0,
        style: { display: "hidden" },
      },
    ];
    const displayModes = resolveDisplayModes(spec, rules);
    // source has no referrers → hidden
    expect(displayModes.get("source")?.display).toBe("hidden");
    // target has a referrer (source) → not hidden
    expect(displayModes.has("target")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Built-in default style: group-child for inputs and metrics
// ---------------------------------------------------------------------------

describe("default group-child for inputs and metrics", () => {
  it("groups a simInput node inside its single referrer", () => {
    const spec: DiagramSpec = {
      nodes: [
        {
          id: "pool",
          label: "Pool",
          type: "default",
          data: { className: "Pool" },
        },
        { id: "capacity", label: "capacity", type: "simInput", data: {} },
      ],
      edges: [{ id: "pool-capacity", source: "pool", target: "capacity" }],
      groups: [],
    };

    const rules: StyleRuleDescriptor[] = [
      {
        name: "default-input-group",
        priority: -1e9,
        match: { type: "simInput" },
        style: { display: "group-child" as const },
      },
    ];

    const displayModes = resolveDisplayModes(spec, rules);
    expect(displayModes.get("capacity")).toEqual({
      display: "group-child",
      groupInto: undefined,
    });

    const transformed = applyDisplayTransforms(spec, displayModes);
    // The input node should NOT appear as a top-level node
    const inputNode = transformed.nodes.find((n) => n.id === "capacity");
    expect(inputNode).toBeDefined();
    expect(inputNode!.parentId).toBe("pool");

    // Pool should be promoted to a group
    const poolGroup = transformed.groups.find((g) => g.id === "pool");
    expect(poolGroup).toBeDefined();

    // The edge between pool and capacity should be removed
    const edge = transformed.edges.find((e) => e.id === "pool-capacity");
    expect(edge).toBeUndefined();
  });

  it("leaves a simInput standalone when referenced by multiple nodes", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "a", label: "A", type: "default" },
        { id: "b", label: "B", type: "default" },
        { id: "input", label: "Input", type: "simInput" },
      ],
      edges: [
        { id: "a-input", source: "a", target: "input" },
        { id: "b-input", source: "b", target: "input" },
      ],
      groups: [],
    };

    const rules: StyleRuleDescriptor[] = [
      {
        name: "default-input-group",
        priority: -1e9,
        match: { type: "simInput" },
        style: { display: "group-child" as const },
      },
    ];

    const displayModes = resolveDisplayModes(spec, rules);
    const transformed = applyDisplayTransforms(spec, displayModes);

    // Input should remain standalone (no parentId) since it has multiple referrers
    const inputNode = transformed.nodes.find((n) => n.id === "input");
    expect(inputNode).toBeDefined();
    expect(inputNode!.parentId).toBeUndefined();
  });

  it("user rule can override default input grouping", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "pool", label: "Pool", type: "default" },
        { id: "capacity", label: "capacity", type: "simInput" },
      ],
      edges: [{ id: "pool-capacity", source: "pool", target: "capacity" }],
      groups: [],
    };

    // Default rule groups inputs; user rule overrides to keep as node
    const rules: StyleRuleDescriptor[] = [
      {
        name: "default-input-group",
        priority: -1e9,
        match: { type: "simInput" },
        style: { display: "group-child" as const },
      },
      {
        name: "user-override",
        priority: 0,
        match: { type: "simInput" },
        style: { display: "node" as const },
      },
    ];

    const displayModes = resolveDisplayModes(spec, rules);
    // User rule wins: display should be "node", which means it won't be in displayModes
    expect(displayModes.has("capacity")).toBe(false);
  });

  it("leaves a simInput standalone when it has no referrers", () => {
    const spec: DiagramSpec = {
      nodes: [{ id: "input", label: "Input", type: "simInput" }],
      edges: [],
      groups: [],
    };

    const rules: StyleRuleDescriptor[] = [
      {
        name: "default-input-group",
        priority: -2e9,
        match: { type: "simInput" },
        style: { display: "group-child" as const },
      },
    ];

    const displayModes = resolveDisplayModes(spec, rules);
    const transformed = applyDisplayTransforms(spec, displayModes);

    // No referrers → no owner → stays standalone
    const inputNode = transformed.nodes.find((n) => n.id === "input");
    expect(inputNode).toBeDefined();
    expect(inputNode!.parentId).toBeUndefined();
  });

  it("metric node with existing parentId keeps its parent", () => {
    const spec: DiagramSpec = {
      nodes: [
        {
          id: "latency",
          label: "latency (Summary)",
          type: "metric",
          parentId: "db",
        },
      ],
      edges: [],
      groups: [{ id: "db", label: "DB", data: { className: "DB" } }],
    };

    const rules: StyleRuleDescriptor[] = [
      {
        name: "default-metric-group",
        priority: -2e9,
        match: { type: "metric" },
        style: { display: "group-child" as const },
      },
    ];

    const displayModes = resolveDisplayModes(spec, rules);
    const transformed = applyDisplayTransforms(spec, displayModes);

    // Metric should still be parented to "db"
    const metricNode = transformed.nodes.find((n) => n.id === "latency");
    expect(metricNode).toBeDefined();
    expect(metricNode!.parentId).toBe("db");

    // Group should still exist
    expect(transformed.groups.find((g) => g.id === "db")).toBeDefined();
  });

  it("metric node with single referrer and no parentId gets grouped", () => {
    const spec: DiagramSpec = {
      nodes: [
        { id: "db", label: "DB", type: "default" },
        { id: "latency", label: "latency", type: "metric" },
      ],
      edges: [{ id: "db-latency", source: "db", target: "latency" }],
      groups: [],
    };

    const rules: StyleRuleDescriptor[] = [
      {
        name: "default-metric-group",
        priority: -2e9,
        match: { type: "metric" },
        style: { display: "group-child" as const },
      },
    ];

    const displayModes = resolveDisplayModes(spec, rules);
    const transformed = applyDisplayTransforms(spec, displayModes);

    // Metric should be re-parented into "db"
    const metricNode = transformed.nodes.find((n) => n.id === "latency");
    expect(metricNode).toBeDefined();
    expect(metricNode!.parentId).toBe("db");

    // "db" should be promoted to a group
    expect(transformed.groups.find((g) => g.id === "db")).toBeDefined();

    // Edge should be removed
    expect(transformed.edges).toEqual([]);
  });
});
