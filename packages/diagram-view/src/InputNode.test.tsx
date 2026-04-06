/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { InputNode } from "./InputNode";
import { ReactFlowProvider } from "@xyflow/react";
import type { DiagramNodeComponentProps } from "./types";

function renderInputNode(overrides: Partial<DiagramNodeComponentProps> = {}) {
  const props: DiagramNodeComponentProps = {
    id: "test-input",
    label: "test-input",
    data: {
      label: "Capacity",
      inputKind: "number",
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 50,
    },
    ...overrides,
  };
  return render(
    <ReactFlowProvider>
      <InputNode {...props} />
    </ReactFlowProvider>,
  );
}

/** Query inside the input-node test wrapper to avoid ReactFlow duplicates. */
function getNode(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-testid='input-node']");
  if (!(el instanceof HTMLElement)) throw new Error("input-node not found");
  return el;
}

function getInput(container: HTMLElement, testId: string): HTMLInputElement {
  const el = getNode(container).querySelector(`[data-testid='${testId}']`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`${testId} not found`);
  return el;
}

describe("InputNode", () => {
  it("[in-box] renders with border styling like a regular node", () => {
    const { container } = renderInputNode();
    const box = getNode(container);
    expect(box.style.border).toContain("1px solid");
    expect(box.style.borderRadius).toBe("4px");
  });

  it("[in-handles] renders source and target handles", () => {
    const { container } = renderInputNode();
    const node = getNode(container);
    const handles = node.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(2);
  });

  it("[in-label] renders the node label", () => {
    const { container } = renderInputNode();
    expect(getNode(container).textContent).toContain("Capacity");
  });

  it("[in-desc] renders label with hint tooltip when description is provided", () => {
    const { container } = renderInputNode({
      data: {
        label: "Capacity",
        description: "Max concurrent requests",
        inputKind: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
      },
    });
    const hint = getNode(container).querySelector(".diagram-label-hint");
    expect(hint).toBeTruthy();
    expect(hint?.getAttribute("title")).toBe("Max concurrent requests");
    expect(hint?.textContent).toBe("Capacity");
  });

  it("[in-no-desc] renders plain label when description is absent", () => {
    const { container } = renderInputNode();
    const hint = getNode(container).querySelector(".diagram-label-hint");
    expect(hint).toBeFalsy();
  });

  it("[in-slider] renders a slider for numeric input kind", () => {
    const { container } = renderInputNode();
    expect(
      getNode(container).querySelector("[data-testid='input-slider']"),
    ).toBeTruthy();
  });

  it("[in-toggle] renders a checkbox for boolean input kind", () => {
    const { container } = renderInputNode({
      data: { label: "Toggle", inputKind: "boolean", defaultValue: 0 },
    });
    expect(
      getNode(container).querySelector("[data-testid='input-toggle']"),
    ).toBeTruthy();
  });

  it("[in-slider-change] calls onValueChange when slider changes", () => {
    const onValueChange = vi.fn();
    const { container } = renderInputNode({
      data: {
        label: "Cap",
        inputKind: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
        onValueChange,
      },
    });
    const slider = getInput(container, "input-slider");
    fireEvent.change(slider, { target: { value: "75" } });
    expect(onValueChange).toHaveBeenCalledWith("test-input", 75);
  });

  it("[in-toggle-change] calls onValueChange when toggle changes", () => {
    const onValueChange = vi.fn();
    const { container } = renderInputNode({
      data: {
        label: "Toggle",
        inputKind: "boolean",
        defaultValue: 0,
        onValueChange,
      },
    });
    const toggle = getInput(container, "input-toggle");
    fireEvent.click(toggle);
    expect(onValueChange).toHaveBeenCalledWith("test-input", true);
  });

  it("[in-bool-default] interprets numeric defaultValue for boolean", () => {
    const { container } = renderInputNode({
      data: { label: "Toggle", inputKind: "boolean", defaultValue: 1 },
    });
    const toggle = getInput(container, "input-toggle");
    expect(toggle.checked).toBe(true);
  });

  it("[in-bool-default-false] interprets boolean false defaultValue", () => {
    const { container } = renderInputNode({
      data: { label: "Toggle", inputKind: "boolean", defaultValue: false },
    });
    const toggle = getInput(container, "input-toggle");
    expect(toggle.checked).toBe(false);
  });

  it("[in-no-data] renders with empty label when data.label is missing", () => {
    const { container } = renderInputNode({ data: {} });
    expect(getNode(container)).toBeTruthy();
  });

  it("[in-no-callback] slider works without onValueChange", () => {
    const { container } = renderInputNode({
      data: {
        label: "NoCb",
        inputKind: "number",
        min: 0,
        max: 10,
        step: 1,
        defaultValue: 5,
      },
    });
    const slider = getInput(container, "input-slider");
    fireEvent.change(slider, { target: { value: "3" } });
  });

  it("[in-non-fn-callback] ignores non-function onValueChange", () => {
    const { container } = renderInputNode({
      data: {
        label: "Bad",
        inputKind: "number",
        defaultValue: 5,
        onValueChange: "not-a-fn",
      },
    });
    const slider = getInput(container, "input-slider");
    fireEvent.change(slider, { target: { value: "3" } });
  });

  it("[in-value-display] displays the formatted default value above the slider", () => {
    const { container } = renderInputNode();
    const node = getNode(container);
    const valueEl = node.querySelector("[data-testid='slider-value']");
    expect(valueEl?.textContent).toBe("50");
  });

  it("[in-fp-format] formats value to step precision to avoid floating point noise", () => {
    const { container } = renderInputNode({
      data: {
        label: "Rate",
        inputKind: "number",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.15,
      },
    });
    const node = getNode(container);
    const valueEl = node.querySelector("[data-testid='slider-value']");
    // Should show "0.15", not "0.15000000000000002"
    expect(valueEl?.textContent).toBe("0.15");
  });

  it("[in-controlled-value] renders the controlled `value` prop, preferring it over defaultValue", () => {
    const { container } = renderInputNode({
      data: {
        label: "Cap",
        inputKind: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
        value: 42,
      },
    });
    const slider = getInput(container, "input-slider");
    expect(slider.value).toBe("42");
    const node = getNode(container);
    const valueEl = node.querySelector("[data-testid='slider-value']");
    expect(valueEl?.textContent).toBe("42");
  });

  it("[in-sync-value] syncs slider when controlled `value` prop changes", () => {
    const renderWith = (value: number) => (
      <ReactFlowProvider>
        <InputNode
          id="test-input"
          label="test-input"
          data={{
            label: "Cap",
            inputKind: "number",
            min: 0,
            max: 100,
            step: 1,
            defaultValue: 50,
            value,
          }}
        />
      </ReactFlowProvider>
    );
    const { container, rerender } = render(renderWith(50));
    const slider = getInput(container, "input-slider");
    expect(slider.value).toBe("50");

    rerender(renderWith(75));
    expect(slider.value).toBe("75");
    const node = getNode(container);
    const valueEl = node.querySelector("[data-testid='slider-value']");
    expect(valueEl?.textContent).toBe("75");
  });

  it("[in-ignore-default-change] keeps controlled value when only defaultValue prop changes", () => {
    // Regression: previously a useEffect snapped the slider back to
    // `defaultValue` on every rebuild, wiping user edits when Start fired.
    const renderWith = (defaultValue: number) => (
      <ReactFlowProvider>
        <InputNode
          id="test-input"
          label="test-input"
          data={{
            label: "Cap",
            inputKind: "number",
            min: 0,
            max: 100,
            step: 1,
            defaultValue,
            value: 42,
          }}
        />
      </ReactFlowProvider>
    );
    const { container, rerender } = render(renderWith(50));
    const slider = getInput(container, "input-slider");
    expect(slider.value).toBe("42");

    rerender(renderWith(10));
    // `value` is unchanged — the slider must not snap to the new default.
    expect(slider.value).toBe("42");
  });
});
