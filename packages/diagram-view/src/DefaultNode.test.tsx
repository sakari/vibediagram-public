/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DefaultNode } from "./DefaultNode";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

/** Safely extract the first child as an HTMLElement, throwing if missing. */
function firstChildElement(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement)) {
    throw new Error("Expected firstChild to be an HTMLElement");
  }
  return el;
}

function renderNode(overrides: Partial<NodeProps> = {}) {
  const props: NodeProps = {
    id: "test-node",
    type: "default",
    data: { label: "Test Label" },
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 0,
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    ...overrides,
  };
  return render(
    <ReactFlowProvider>
      <DefaultNode {...props} />
    </ReactFlowProvider>,
  );
}

describe("DefaultNode", () => {
  it("[dn-label] renders the node label text", () => {
    renderNode();
    expect(screen.getByText("Test Label")).toBeTruthy();
  });

  it("[dn-style] applies NodeStyle background", () => {
    const { container } = renderNode({
      data: { label: "Styled", nodeStyle: { background: "#ff0000" } },
    });
    const box = container.firstChild;
    expect(box instanceof HTMLElement && box.style.background).toContain(
      "255, 0, 0",
    );
  });

  it("[dn-style] applies NodeStyle borderColor", () => {
    const { container } = renderNode({
      data: { label: "Bordered", nodeStyle: { borderColor: "#00ff00" } },
    });
    const box = container.firstChild;
    expect(box instanceof HTMLElement && box.style.borderColor).toContain(
      "0, 255, 0",
    );
  });

  it("[dn-style] applies NodeStyle boxShadow", () => {
    const { container } = renderNode({
      data: {
        label: "Shadow",
        nodeStyle: { boxShadow: "0 2px 8px rgba(0,0,0,0.25)" },
      },
    });
    const box = container.firstChild;
    expect(box instanceof HTMLElement && box.style.boxShadow).toContain("rgba");
  });

  it("[dn-handles] renders source and target handles", () => {
    const { container } = renderNode();
    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(2);
  });

  it("[dn-data] passes data through to render", () => {
    renderNode({ data: { label: "Custom Data", gauge: 0.8 } });
    expect(screen.getByText("Custom Data")).toBeTruthy();
  });

  describe("branch coverage", () => {
    it("[dn-no-style] renders without nodeStyle", () => {
      const { container } = renderNode({ data: { label: "Plain" } });
      const box = container.querySelector("div")!;
      expect(box.style.background).toContain("30, 30, 46");
    });

    it("[dn-borderwidth] applies borderWidth from nodeStyle", () => {
      const { container } = renderNode({
        data: { label: "SW", nodeStyle: { borderWidth: 3 } },
      });
      const box = container.querySelector("div")!;
      expect(box.style.borderWidth).toBe("3px");
    });

    it("[dn-opacity] applies opacity from nodeStyle", () => {
      const { container } = renderNode({
        data: { label: "Op", nodeStyle: { opacity: 0.5 } },
      });
      const box = container.querySelector("div")!;
      expect(box.style.opacity).toBe("0.5");
    });

    it("[dn-nonstring-label] renders empty string for non-string label", () => {
      const { container } = renderNode({ data: { label: 42 } });
      const labelDiv = container.querySelector("div > div");
      expect(labelDiv?.textContent).toBe("");
    });

    it("[dn-invalid-nodestyle] treats non-object nodeStyle as undefined", () => {
      const { container } = renderNode({
        data: { label: "X", nodeStyle: "not-an-object" },
      });
      const box = container.querySelector("div")!;
      expect(box.style.background).toContain("30, 30, 46");
    });
  });

  describe("description", () => {
    it("[dn-desc] adds hint class and title on label", () => {
      const { container } = renderNode({
        data: { label: "Node", description: "Handles requests" },
      });
      const labelEl = container.querySelector(".diagram-label-hint");
      expect(labelEl).not.toBeNull();
      expect(labelEl!.getAttribute("title")).toBe("Handles requests");
      expect(labelEl!.textContent).toBe("Node");
    });

    it("[dn-no-desc] does not add hint class when description absent", () => {
      const { container } = renderNode({ data: { label: "Solo" } });
      expect(container.querySelector(".diagram-label-hint")).toBeNull();
    });

    it("[dn-desc-empty] does not add hint class for empty description", () => {
      const { container } = renderNode({
        data: { label: "Node", description: "" },
      });
      expect(container.querySelector(".diagram-label-hint")).toBeNull();
    });
  });

  describe("inline children", () => {
    it("[dn-inline] renders inline children as text rows", () => {
      renderNode({
        data: {
          label: "Parent",
          inlineChildren: [
            { id: "c1", label: "Child 1" },
            { id: "c2", label: "Child 2" },
          ],
        },
      });
      expect(screen.getByText("Child 1")).toBeTruthy();
      expect(screen.getByText("Child 2")).toBeTruthy();
    });

    it("[dn-no-inline] does not render inline section when no inlineChildren", () => {
      const { container } = renderNode({ data: { label: "Solo" } });
      // No element with borderTop style (the inline separator)
      const inlineSection = container.querySelector("[style*='border-top']");
      expect(inlineSection).toBeNull();
    });

    it("[dn-invalid-inline] treats invalid inlineChildren as undefined", () => {
      const { container } = renderNode({
        data: { label: "Bad", inlineChildren: "not-an-array" },
      });
      const inlineSection = container.querySelector("[style*='border-top']");
      expect(inlineSection).toBeNull();
    });
  });

  describe("node shapes", () => {
    it("[dn-shape-svg] renders an SVG element for cylinder shape", () => {
      const { container } = renderNode({
        data: { label: "DB", nodeStyle: { shape: "cylinder" } },
      });
      expect(container.querySelector("svg")).not.toBeNull();
    });

    it("[dn-shape-rect] does not render SVG for rectangle shape", () => {
      const { container } = renderNode({
        data: { label: "Box", nodeStyle: { shape: "rectangle" } },
      });
      expect(container.querySelector("svg")).toBeNull();
    });

    it("[dn-shape-none] does not render SVG when no shape is set", () => {
      const { container } = renderNode({
        data: { label: "Plain" },
      });
      expect(container.querySelector("svg")).toBeNull();
    });

    it("[dn-shape-rounded] has borderRadius 16 for rounded-rectangle", () => {
      const { container } = renderNode({
        data: { label: "Rounded", nodeStyle: { shape: "rounded-rectangle" } },
      });
      const box = firstChildElement(container);
      expect(box.style.borderRadius).toBe("16px");
    });

    it("[dn-shape-transparent] SVG shape has transparent background and no border", () => {
      const { container } = renderNode({
        data: { label: "Diamond", nodeStyle: { shape: "diamond" } },
      });
      const box = firstChildElement(container);
      expect(box.style.background).toBe("transparent");
      expect(box.style.borderStyle).toBe("none");
    });

    it("[dn-shape-no-leak] shape is not leaked into inline CSS", () => {
      const { container } = renderNode({
        data: {
          label: "Hex",
          nodeStyle: { shape: "hexagon", background: "#ff0000" },
        },
      });
      const box = firstChildElement(container);
      // The style attribute should not contain "shape"
      const styleAttr = box.getAttribute("style") ?? "";
      expect(styleAttr).not.toContain("shape");
    });
  });
});
