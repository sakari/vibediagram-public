import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SimStatus } from "@diagram/sim-worker";
import SimulationToolbar from "./SimulationToolbar";

function defaultProps() {
  return {
    status: "running" as SimStatus,
    simTime: 10,
    error: null,
    speed: 1,
    timeWindow: null as number | null,
    onRun: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStep: vi.fn(),
    onReset: vi.fn(),
    onSetSpeed: vi.fn(),
    onSetTimeWindow: vi.fn(),
  };
}

describe("SimulationToolbar", () => {
  it("renders speed dropdown with current value selected", () => {
    const props = defaultProps();
    props.speed = 2;
    const { container } = render(<SimulationToolbar {...props} />);

    const speedSelect =
      container.querySelectorAll<HTMLSelectElement>("select")[0];
    expect(speedSelect.value).toBe("2");
  });

  it("calls onSetSpeed when speed dropdown changes", () => {
    const props = defaultProps();
    const { container } = render(<SimulationToolbar {...props} />);

    const speedSelect =
      container.querySelectorAll<HTMLSelectElement>("select")[0];
    fireEvent.change(speedSelect, { target: { value: "10" } });
    expect(props.onSetSpeed).toHaveBeenCalledWith(10);
  });

  it("renders time window dropdown with current value selected", () => {
    const props = defaultProps();
    props.timeWindow = 60;
    const { container } = render(<SimulationToolbar {...props} />);

    const windowSelect =
      container.querySelectorAll<HTMLSelectElement>("select")[1];
    expect(windowSelect.value).toBe("60");
  });

  it("calls onSetTimeWindow with number when a time option is selected", () => {
    const props = defaultProps();
    const { container } = render(<SimulationToolbar {...props} />);

    const windowSelect =
      container.querySelectorAll<HTMLSelectElement>("select")[1];
    fireEvent.change(windowSelect, { target: { value: "30" } });
    expect(props.onSetTimeWindow).toHaveBeenCalledWith(30);
  });

  it("calls onSetTimeWindow with null when All is selected", () => {
    const props = defaultProps();
    props.timeWindow = 30;
    const { container } = render(<SimulationToolbar {...props} />);

    const windowSelect =
      container.querySelectorAll<HTMLSelectElement>("select")[1];
    fireEvent.change(windowSelect, { target: { value: "" } });
    expect(props.onSetTimeWindow).toHaveBeenCalledWith(null);
  });

  it("speed dropdown is enabled when simulation is idle", () => {
    const props = defaultProps();
    props.status = "idle";
    const { container } = render(<SimulationToolbar {...props} />);

    const speedSelect =
      container.querySelectorAll<HTMLSelectElement>("select")[0];
    expect(speedSelect.disabled).toBe(false);
  });
});
