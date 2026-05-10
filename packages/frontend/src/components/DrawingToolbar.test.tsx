import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DrawingToolbar, type DrawingState } from "./DrawingToolbar";

// vitest does not auto-cleanup React Testing Library renders between tests
// here (no globals/setupFiles configured). Without explicit cleanup the
// previous render's DOM stays mounted and `screen.getByRole` finds duplicates.
afterEach(() => {
  cleanup();
});

function setup(overrides: Partial<{ canWrite: boolean }> = {}) {
  const onClear = vi.fn();
  const onStateChange = vi.fn<(state: DrawingState) => void>();
  const utils = render(
    <DrawingToolbar
      canWrite={overrides.canWrite ?? true}
      onClear={onClear}
      onStateChange={onStateChange}
    />,
  );
  return { onClear, onStateChange, ...utils };
}

const lastState = (
  spy: ReturnType<typeof vi.fn<(state: DrawingState) => void>>,
): DrawingState => {
  const calls = spy.mock.calls;
  if (calls.length === 0) throw new Error("onStateChange never called");
  return calls[calls.length - 1][0];
};

describe("DrawingToolbar", () => {
  it("emits the default state on mount (hand tool, no pen controls visible)", () => {
    const { onStateChange } = setup();

    expect(onStateChange).toHaveBeenCalled();
    expect(lastState(onStateChange)).toEqual(
      expect.objectContaining({
        tool: "hand",
        color: "#ff5252",
        width: 4,
      }),
    );
  });

  it("shows the three tool buttons immediately and hides pen controls when not in pen mode", () => {
    setup();

    // The three tool buttons are always visible.
    expect(screen.getByRole("button", { name: /Hand/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Pen" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Eraser" })).not.toBeNull();
    // Color/width swatches are pen-only and hidden by default.
    expect(screen.queryByLabelText("Color #ff5252")).toBeNull();
    expect(screen.queryByLabelText("Width 4")).toBeNull();
  });

  it("switches between hand, pen, and eraser tools", () => {
    const { onStateChange } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Pen" }));
    expect(lastState(onStateChange).tool).toBe("pen");

    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    expect(lastState(onStateChange).tool).toBe("eraser");

    fireEvent.click(screen.getByRole("button", { name: /Hand/ }));
    expect(lastState(onStateChange).tool).toBe("hand");
  });

  it("reveals color/width pickers only when pen is selected", () => {
    setup();

    expect(screen.queryByLabelText("Color #ff5252")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pen" }));
    expect(screen.getByLabelText("Color #ff5252")).not.toBeNull();
    expect(screen.getByLabelText("Width 4")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    // Pen-specific controls hide again.
    expect(screen.queryByLabelText("Color #ff5252")).toBeNull();
  });

  it("picks a color from the swatch row", () => {
    const { onStateChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pen" }));

    fireEvent.click(screen.getByRole("button", { name: "Color #69f0ae" }));
    expect(lastState(onStateChange).color).toBe("#69f0ae");
  });

  it("picks a width from the width row", () => {
    const { onStateChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pen" }));

    fireEvent.click(screen.getByRole("button", { name: "Width 8" }));
    expect(lastState(onStateChange).width).toBe(8);

    fireEvent.click(screen.getByRole("button", { name: "Width 2" }));
    expect(lastState(onStateChange).width).toBe(2);
  });

  it("shows clear-all (and calls onClear) when canWrite is true; tool selection does not gate it", () => {
    const { onClear } = setup({ canWrite: true });

    // The clear button is always present for writers, regardless of tool.
    fireEvent.click(screen.getByRole("button", { name: "Clear all drawings" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("hides the clear-all button when canWrite is false", () => {
    const { onClear } = setup({ canWrite: false });
    expect(screen.queryByLabelText("Clear all drawings")).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });
});
