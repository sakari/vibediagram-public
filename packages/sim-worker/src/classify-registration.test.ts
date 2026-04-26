import { describe, it, expect, vi, beforeAll } from "vitest";
import { Blueprint, InputNode } from "@diagram/sim-model";
import type { Registration } from "@diagram/sim-model";
import type { DiagramNode, DiagramGroup } from "@diagram/diagram-view";

// Stub `self` so the worker module's top-level `self.onmessage = ...` does not throw.
vi.stubGlobal("self", { onmessage: null });

// Dynamic import after the stub is in place.
let classifyRegistration: typeof import("./worker").classifyRegistration;

beforeAll(async () => {
  const mod = await import("./worker");
  classifyRegistration = mod.classifyRegistration;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Registration for a Blueprint instance. */
function makeBlueprint(
  overrides: Partial<Registration> & { name: string },
): Registration {
  return {
    instance: new (class TestBlueprint extends Blueprint {})(),
    pendingParams: {},
    paramsSchema: {},
    frameworkSentinels: [],
    className: "TestBlueprint",
    spawnChildren: [],
    wired: false,
    ...overrides,
  };
}

/** Build a minimal Registration for an InputNode instance. */
function makeInputNode(
  overrides: Partial<Registration> & { name: string },
): Registration {
  return {
    instance: new InputNode(),
    pendingParams: {},
    paramsSchema: {},
    frameworkSentinels: [],
    className: "InputNode",
    spawnChildren: [],
    wired: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("classifyRegistration", () => {
  it("propagates description to a default node", () => {
    const nodes: DiagramNode[] = [];
    const groups: DiagramGroup[] = [];
    const reg = makeBlueprint({
      name: "server",
      description: "Handles HTTP requests",
    });

    classifyRegistration(reg, {}, nodes, groups);

    expect(nodes[0].id).toBe("server");
    expect(nodes[0].data).toHaveProperty(
      "description",
      "Handles HTTP requests",
    );
  });

  it("propagates description to a group node", () => {
    const nodes: DiagramNode[] = [];
    const groups: DiagramGroup[] = [];
    const reg = makeBlueprint({
      name: "loadBalancer",
      description: "Distributes traffic",
    });
    const metricOwnership = { loadBalancer: ["m1"] };

    classifyRegistration(reg, metricOwnership, nodes, groups);

    expect(groups[0].id).toBe("loadBalancer");
    expect(groups[0].data).toHaveProperty("description", "Distributes traffic");
  });

  it("omits description from data when registration has no description", () => {
    const nodes: DiagramNode[] = [];
    const groups: DiagramGroup[] = [];
    const reg = makeBlueprint({ name: "cache" });

    classifyRegistration(reg, {}, nodes, groups);

    expect(nodes[0].data).not.toHaveProperty("description");
  });

  it("propagates description to InputNode registrations", () => {
    const nodes: DiagramNode[] = [];
    const groups: DiagramGroup[] = [];
    const reg = makeInputNode({
      name: "slider",
      description: "Controls request rate",
    });

    classifyRegistration(reg, {}, nodes, groups);

    expect(nodes[0].data).toHaveProperty(
      "description",
      "Controls request rate",
    );
  });

  it("omits description from InputNode data when registration has no description", () => {
    const nodes: DiagramNode[] = [];
    const groups: DiagramGroup[] = [];
    const reg = makeInputNode({ name: "slider" });

    classifyRegistration(reg, {}, nodes, groups);

    expect(nodes[0].data).not.toHaveProperty("description");
  });

  it("omits description from group data when registration has no description", () => {
    const nodes: DiagramNode[] = [];
    const groups: DiagramGroup[] = [];
    const reg = makeBlueprint({ name: "db" });
    const metricOwnership = { db: ["m1"] };

    classifyRegistration(reg, metricOwnership, nodes, groups);

    expect(groups[0].data).not.toHaveProperty("description");
  });
});
