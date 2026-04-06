/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupNode } from "./GroupNode";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

function renderGroup(overrides: Partial<NodeProps> = {}) {
  const props: NodeProps = {
    id: "test-group",
    type: "group",
    data: { label: "Test Group" },
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
      <GroupNode {...props} />
    </ReactFlowProvider>,
  );
}

describe("GroupNode", () => {
  it("[gn-label] renders the group label in a header", () => {
    renderGroup();
    expect(screen.getByText("Test Group")).toBeTruthy();
  });

  it("[gn-children] has a container area for child nodes", () => {
    const { container } = renderGroup();
    const groupContainer = container.querySelector(
      "[data-testid='group-container']",
    );
    expect(groupContainer).not.toBeNull();

    expect(groupContainer!.getAttribute("style")).toContain(
      "position: relative",
    );
  });

  it("[gn-style] applies NodeStyle background", () => {
    const { container } = renderGroup({
      data: {
        label: "Styled Group",
        nodeStyle: { background: "rgba(100, 0, 0, 0.5)" },
      },
    });
    const groupContainer = container.querySelector(
      "[data-testid='group-container']",
    );
    expect(
      groupContainer instanceof HTMLElement && groupContainer.style.background,
    ).toBe("rgba(100, 0, 0, 0.5)");
  });

  it("[gn-style] applies NodeStyle borderColor", () => {
    const { container } = renderGroup({
      data: { label: "Bordered Group", nodeStyle: { borderColor: "#00ff00" } },
    });
    const groupContainer = container.querySelector(
      "[data-testid='group-container']",
    );
    expect(
      groupContainer instanceof HTMLElement && groupContainer.style.borderColor,
    ).toContain("0, 255, 0");
  });

  it("[gn-handles] renders hidden source and target handles for edge connections", () => {
    const { container } = renderGroup();
    const handles = container.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(2);
    for (const handle of handles) {
      expect(handle instanceof HTMLElement && handle.style.visibility).toBe(
        "hidden",
      );
    }
  });

  describe("description", () => {
    it("[gn-desc] adds hint class and title on label", () => {
      const { container } = renderGroup({
        data: { label: "My Group", description: "Handles requests" },
      });
      const labelEl = container.querySelector(".diagram-label-hint");
      expect(labelEl).not.toBeNull();
      expect(labelEl!.getAttribute("title")).toBe("Handles requests");
      expect(labelEl!.textContent).toBe("My Group");
    });

    it("[gn-no-desc] does not add hint class when description absent", () => {
      const { container } = renderGroup({ data: { label: "Solo" } });
      expect(container.querySelector(".diagram-label-hint")).toBeNull();
    });
  });

  describe("branch coverage", () => {
    it("[gn-no-style] renders without nodeStyle", () => {
      const { container } = renderGroup({ data: { label: "Plain Group" } });
      const gc = container.querySelector<HTMLElement>(
        "[data-testid='group-container']",
      )!;
      expect(gc.style.background).toBe("rgba(30, 30, 46, 0.5)");
    });

    it("[gn-borderwidth] applies borderWidth from nodeStyle", () => {
      const { container } = renderGroup({
        data: { label: "SW Group", nodeStyle: { borderWidth: 2 } },
      });
      const gc = container.querySelector<HTMLElement>(
        "[data-testid='group-container']",
      )!;
      expect(gc.style.borderWidth).toBe("2px");
    });

    it("[gn-opacity] applies opacity from nodeStyle", () => {
      const { container } = renderGroup({
        data: { label: "Op Group", nodeStyle: { opacity: 0.7 } },
      });
      const gc = container.querySelector<HTMLElement>(
        "[data-testid='group-container']",
      )!;
      expect(gc.style.opacity).toBe("0.7");
    });

    it("[gn-nonstring-label] renders empty string for non-string label", () => {
      const { container } = renderGroup({ data: { label: 123 } });
      const headerDiv = container.querySelector(
        "[data-testid='group-container'] > div:nth-child(2)",
      );
      expect(headerDiv?.textContent).toBe("");
    });

    it("[gn-dimensions] uses width/height props when provided", () => {
      const { container } = renderGroup({
        data: { label: "Sized" },
        width: 500,
        height: 300,
      });
      const gc = container.querySelector<HTMLElement>(
        "[data-testid='group-container']",
      )!;
      expect(gc.style.width).toBe("500px");
      expect(gc.style.height).toBe("300px");
    });

    it("[gn-invalid-nodestyle] treats non-object nodeStyle as undefined", () => {
      const { container } = renderGroup({
        data: { label: "X", nodeStyle: [1, 2, 3] },
      });
      const gc = container.querySelector<HTMLElement>(
        "[data-testid='group-container']",
      )!;
      expect(gc.style.background).toBe("rgba(30, 30, 46, 0.5)");
    });
  });
});
