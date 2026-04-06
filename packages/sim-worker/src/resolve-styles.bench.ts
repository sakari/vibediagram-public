import { bench, describe } from "vitest";
import type {
  DiagramSpec,
  DiagramNode,
  DiagramEdge,
} from "@diagram/diagram-view";
import type { StyleRuleDescriptor } from "@diagram/sim-model";
import {
  buildTopologyIndex,
  resolveStyleRules,
  resolveDisplayModes,
  applyDisplayTransforms,
  type MetricsIndex,
} from "./resolve-styles";

// ---------------------------------------------------------------------------
// Synthetic DiagramSpec builder
// ---------------------------------------------------------------------------

function buildSpec(nodeCount: number): DiagramSpec {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node-${String(i)}`,
      label: `Node ${String(i)}`,
      type: i % 5 === 0 ? "simInput" : "default",
      data: { load: i * 10, status: i % 3 === 0 ? "healthy" : "degraded" },
    });
  }

  // Create edges: each node points to the next, plus some cross-edges
  for (let i = 0; i < nodeCount - 1; i++) {
    edges.push({
      id: `edge-${String(i)}`,
      source: `node-${String(i)}`,
      target: `node-${String(i + 1)}`,
      label: "ref",
    });
  }
  // Add some cross-edges for graph complexity
  for (let i = 0; i < nodeCount; i += 3) {
    const target = (i + 5) % nodeCount;
    edges.push({
      id: `cross-${String(i)}`,
      source: `node-${String(i)}`,
      target: `node-${String(target)}`,
      label: "cross",
    });
  }

  return { nodes, edges, groups: [] };
}

function buildMetricsIndex(nodeCount: number): MetricsIndex {
  const index: MetricsIndex = new Map();
  for (let i = 0; i < nodeCount; i++) {
    const metrics = new Map<string, number>();
    metrics.set("utilization", i / nodeCount);
    metrics.set("qps", i * 100);
    index.set(`node-${String(i)}`, metrics);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Style rules
// ---------------------------------------------------------------------------

function objectRules(count: number): StyleRuleDescriptor[] {
  const rules: StyleRuleDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    rules.push({
      name: `rule-${String(i)}`,
      priority: i,
      match: {
        type: i % 2 === 0 ? "default" : "simInput",
        topology: { inDegree: { gte: 0 } },
      },
      style: {
        background: `#${String(i).padStart(6, "0")}`,
        borderWidth: i % 3,
      },
    });
  }
  return rules;
}

function functionRules(count: number): StyleRuleDescriptor[] {
  const rules: StyleRuleDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    rules.push({
      name: `fn-rule-${String(i)}`,
      priority: i,
      match: (node, graph) => {
        // Exercise referrers() and rank()
        const refs = graph.referrers(node);
        const r = graph.rank(node, "utilization");
        return refs.length > 0 && r > 0;
      },
      style: (node) => {
        const util = node.metric("utilization") ?? 0;
        const r = Math.round(200 * util);
        return {
          background: `rgb(${String(r)}, 50, 50)`,
          borderColor: util > 0.8 ? "#ff4444" : "#3498db",
        };
      },
    });
  }
  return rules;
}

function mixedRules(count: number): StyleRuleDescriptor[] {
  const obj = objectRules(Math.ceil(count / 2));
  const fn = functionRules(Math.floor(count / 2));
  return [...obj, ...fn];
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("buildTopologyIndex", () => {
  bench("10 nodes", () => {
    buildTopologyIndex(buildSpec(10));
  });

  bench("50 nodes", () => {
    buildTopologyIndex(buildSpec(50));
  });

  bench("200 nodes", () => {
    buildTopologyIndex(buildSpec(200));
  });
});

describe("resolveStyleRules - object matchers", () => {
  bench("10 nodes, 5 rules", () => {
    resolveStyleRules(buildSpec(10), objectRules(5), buildMetricsIndex(10));
  });

  bench("50 nodes, 10 rules", () => {
    resolveStyleRules(buildSpec(50), objectRules(10), buildMetricsIndex(50));
  });

  bench("200 nodes, 20 rules", () => {
    resolveStyleRules(buildSpec(200), objectRules(20), buildMetricsIndex(200));
  });
});

describe("resolveStyleRules - function matchers", () => {
  bench("50 nodes, 10 rules (referrers + rank)", () => {
    resolveStyleRules(buildSpec(50), functionRules(10), buildMetricsIndex(50));
  });

  bench("200 nodes, 10 rules (referrers + rank)", () => {
    resolveStyleRules(
      buildSpec(200),
      functionRules(10),
      buildMetricsIndex(200),
    );
  });
});

describe("full style pipeline", () => {
  bench("50 nodes, 10 mixed rules", () => {
    const spec = buildSpec(50);
    const rules = mixedRules(10);
    const metrics = buildMetricsIndex(50);
    const displayModes = resolveDisplayModes(spec, rules, metrics);
    const transformed = applyDisplayTransforms(spec, displayModes);
    resolveStyleRules(transformed, rules, metrics);
  });

  bench("200 nodes, 20 mixed rules", () => {
    const spec = buildSpec(200);
    const rules = mixedRules(20);
    const metrics = buildMetricsIndex(200);
    const displayModes = resolveDisplayModes(spec, rules, metrics);
    const transformed = applyDisplayTransforms(spec, displayModes);
    resolveStyleRules(transformed, rules, metrics);
  });
});
