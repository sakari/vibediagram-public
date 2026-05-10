/**
 * @vitest-environment jsdom
 *
 * Smoke test for DiagramRenderer. Verifies component composition
 * and loading state. Full visual/interaction testing uses the spike
 * dev page — React Flow needs real DOM measurement for node rendering.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import type { DiagramSpec } from "./types";

// Mock ResizeObserver for jsdom
let resizeCallback: ResizeObserverCallback | null = null;
const mockDisconnect = vi.fn();
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(cb: ResizeObserverCallback) {
      resizeCallback = cb;
    }
    observe() {}
    disconnect() {
      mockDisconnect();
    }
    unobserve() {}
  },
);

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

import type { CoordTransform } from "@diagram/draw-overlay";
import {
  DiagramRenderer,
  extractChangedSizes,
  measuredSizesFingerprint,
} from "./DiagramRenderer";

const spec: DiagramSpec = {
  nodes: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ],
  edges: [{ id: "e1", source: "a", target: "b" }],
  groups: [],
};

describe("DiagramRenderer", () => {
  it("[dr-loading] shows loading state initially", () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    expect(screen.getByTestId("diagram-loading")).toBeTruthy();
    expect(screen.getByText("Computing layout...")).toBeTruthy();
  });

  it("[dr-renders] transitions from loading to rendered after layout completes", async () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("diagram-loading")).toBeNull();
    });
  });

  it("[dr-renders] mounts ReactFlow after layout", async () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
    });
  });

  it("[dr-resize] sets up ResizeObserver after layout completes", async () => {
    const { container, unmount } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
    });

    // ResizeObserver should have been registered after layout
    expect(resizeCallback).not.toBeNull();

    // Simulate a resize event — should not throw
    resizeCallback!(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
      [{ contentRect: { width: 1200 } } as ResizeObserverEntry],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
      null as unknown as ResizeObserver,
    );

    // Cleanup disconnects the observer
    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("[dr-node-types] accepts consumer nodeTypes without error", async () => {
    const CustomNode = () => <div>Custom</div>;
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} nodeTypes={{ custom: CustomNode }} />
      </div>,
    );

    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
    });
  });

  it("[dr-overlay-absent] does not mount the overlay host when renderOverlay is omitted", async () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    await waitFor(() => {
      expect(container.querySelector(".react-flow")).not.toBeNull();
    });

    // Acceptance: the default DOM is unchanged — no overlay host wrapper.
    // This is what protects existing visual regression baselines.
    expect(container.querySelector(".diagram-view-overlay-host")).toBeNull();
  });

  it("[dr-overlay-transform] passes a working CoordTransform to renderOverlay", async () => {
    let captured: CoordTransform | null = null;
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer
          spec={spec}
          renderOverlay={(transform) => {
            captured = transform;
            return <div data-testid="test-overlay">overlay</div>;
          }}
        />
      </div>,
    );

    await waitFor(() => {
      expect(container.querySelector(".react-flow")).not.toBeNull();
      expect(
        container.querySelector(".diagram-view-overlay-host"),
      ).not.toBeNull();
      expect(captured).not.toBeNull();
    });

    // The transform should expose the three CoordTransform methods and
    // the screen<->content round-trip should produce numeric coordinates.
    // We don't assert exact values — without a real layout box, jsdom's
    // React Flow projection is degenerate — only that the contract holds.
    const transform = captured!;
    const content = transform.toContent(100, 100);
    expect(content).not.toBeNull();
    expect(typeof content!.x).toBe("number");
    expect(typeof content!.y).toBe("number");

    const screen = transform.toScreen(0, 0);
    expect(screen).not.toBeNull();
    // Confirm the {x, y} -> {left, top} translation happened.
    expect(typeof screen!.left).toBe("number");
    expect(typeof screen!.top).toBe("number");
  });

  it("[dr-overlay-subscribe] subscribe registers and unregisters callbacks", async () => {
    let captured: CoordTransform | null = null;
    render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer
          spec={spec}
          renderOverlay={(transform) => {
            captured = transform;
            return null;
          }}
        />
      </div>,
    );

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });

    // The contract is "subscribe returns an unsubscribe". We can't easily
    // fire a viewport change in jsdom, but we can confirm the registration
    // path doesn't throw and the unsubscribe is a callable function.
    const cb = vi.fn();
    const unsubscribe = captured!.subscribe(cb);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("[dr-measuring] renders ReactFlow visible during measurement phase", async () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <DiagramRenderer spec={spec} />
      </div>,
    );

    // After layout completes, ReactFlow should be visible (no visibility:hidden)
    // so React Flow can measure node DOM dimensions
    await waitFor(() => {
      const rfElement = container.querySelector(".react-flow");
      expect(rfElement).not.toBeNull();
    });

    const rfWrapper = container.querySelector(".react-flow")?.parentElement;
    const style = rfWrapper?.getAttribute("style") ?? "";
    expect(style).not.toContain("visibility");
  });
});

describe("measuredSizesFingerprint", () => {
  it("[msfp-empty] returns empty string for no nodes", () => {
    expect(measuredSizesFingerprint([])).toBe("");
  });

  it("[msfp-measured] builds fingerprint from measured dimensions", () => {
    const nodes = [
      { id: "a", measured: { width: 200, height: 60 } },
      { id: "b", measured: { width: 180.7, height: 50.3 } },
    ];
    expect(measuredSizesFingerprint(nodes)).toBe("a:200x60,b:181x50,");
  });

  it("[msfp-unmeasured] skips nodes without measurements", () => {
    const nodes = [
      { id: "a", measured: { width: 200, height: 60 } },
      { id: "b", measured: {} },
      { id: "c" },
    ];
    expect(measuredSizesFingerprint(nodes)).toBe("a:200x60,");
  });
});

describe("extractChangedSizes", () => {
  function makeNode(
    id: string,
    measured?: { width: number; height: number },
  ): Node {
    return {
      id,
      position: { x: 0, y: 0 },
      data: {},
      ...(measured ? { measured } : {}),
    };
  }

  it("[ecs-new] returns sizes when no previous sizes exist", () => {
    const nodes = [
      makeNode("a", { width: 200, height: 60 }),
      makeNode("b", { width: 180, height: 50 }),
    ];
    const result = extractChangedSizes(nodes, undefined);
    expect(result).toEqual({
      a: { width: 200, height: 60 },
      b: { width: 180, height: 50 },
    });
  });

  it("[ecs-unchanged] returns undefined when sizes match within threshold", () => {
    const nodes = [
      makeNode("a", { width: 200, height: 60 }),
      makeNode("b", { width: 180, height: 50 }),
    ];
    const prev = {
      a: { width: 200.5, height: 60.5 },
      b: { width: 180.5, height: 50.5 },
    };
    const result = extractChangedSizes(nodes, prev);
    expect(result).toBeUndefined();
  });

  it("[ecs-changed] returns new sizes when a node changes beyond threshold", () => {
    const nodes = [
      makeNode("a", { width: 250, height: 60 }),
      makeNode("b", { width: 180, height: 50 }),
    ];
    const prev = {
      a: { width: 200, height: 60 },
      b: { width: 180, height: 50 },
    };
    const result = extractChangedSizes(nodes, prev);
    expect(result).toEqual({
      a: { width: 250, height: 60 },
      b: { width: 180, height: 50 },
    });
  });

  it("[ecs-unmeasured] skips nodes without measured dimensions", () => {
    const nodes = [
      makeNode("a", { width: 200, height: 60 }),
      makeNode("b"), // no measured
    ];
    const result = extractChangedSizes(nodes, undefined);
    expect(result).toEqual({
      a: { width: 200, height: 60 },
    });
  });

  it("[ecs-empty] returns undefined when no nodes have measurements", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const result = extractChangedSizes(nodes, undefined);
    expect(result).toBeUndefined();
  });
});
