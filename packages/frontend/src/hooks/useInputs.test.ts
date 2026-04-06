import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { InputDescriptor } from "@diagram/sim-model";
import { useInputs } from "./useInputs";

function desc(
  overrides: Partial<InputDescriptor> & { id: string },
): InputDescriptor {
  return {
    label: overrides.id,
    kind: "number",
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    ...overrides,
  };
}

function setup() {
  const bridgeRef = { current: null };
  return renderHook(() => useInputs(bridgeRef));
}

describe("useInputs – onInputsRegistered reconciliation", () => {
  it("seeds new ids from defaultValue", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([desc({ id: "rate" })]);
    });
    expect(result.current.inputValues).toEqual({ rate: 50 });
  });

  it("preserves existing values for unchanged ids", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([desc({ id: "rate" })]);
    });
    act(() => {
      result.current.setInputValue("rate", 80);
    });
    act(() => {
      result.current.onInputsRegistered([desc({ id: "rate" })]);
    });
    expect(result.current.inputValues.rate).toBe(80);
  });

  it("prunes ids no longer in the descriptor list", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "rate" }),
        desc({ id: "burst" }),
      ]);
    });
    act(() => {
      result.current.onInputsRegistered([desc({ id: "rate" })]);
    });
    expect(result.current.inputValues).toEqual({ rate: 50 });
    expect("burst" in result.current.inputValues).toBe(false);
  });

  it("clamps out-of-range values to new bounds", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "rate", min: 0, max: 200 }),
      ]);
    });
    act(() => {
      result.current.setInputValue("rate", 150);
    });
    // Model changes: max shrinks to 100
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "rate", min: 0, max: 100 }),
      ]);
    });
    expect(result.current.inputValues.rate).toBe(100);
  });

  it("clamps below-min values upward", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "rate", min: 0, max: 100 }),
      ]);
    });
    act(() => {
      result.current.setInputValue("rate", 5);
    });
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "rate", min: 10, max: 100 }),
      ]);
    });
    expect(result.current.inputValues.rate).toBe(10);
  });

  it("snaps to step grid", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "rate", min: 0, max: 100, step: 10 }),
      ]);
    });
    act(() => {
      result.current.setInputValue("rate", 37);
    });
    // Re-register with same bounds — value should snap to nearest step
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "rate", min: 0, max: 100, step: 10 }),
      ]);
    });
    expect(result.current.inputValues.rate).toBe(40);
  });

  it("resets to default when kind changes from number to boolean", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([desc({ id: "flag", kind: "number" })]);
    });
    act(() => {
      result.current.setInputValue("flag", 42);
    });
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "flag", kind: "boolean", defaultValue: 1 }),
      ]);
    });
    expect(result.current.inputValues.flag).toBe(true);
  });

  it("resets to default when kind changes from boolean to number", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "flag", kind: "boolean", defaultValue: 1 }),
      ]);
    });
    // Boolean values are stored as boolean type
    expect(result.current.inputValues.flag).toBe(true);
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "flag", kind: "number", defaultValue: 25 }),
      ]);
    });
    expect(result.current.inputValues.flag).toBe(25);
  });

  it("preserves boolean values when kind stays boolean", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "flag", kind: "boolean", defaultValue: 0 }),
      ]);
    });
    act(() => {
      result.current.setInputValue("flag", true);
    });
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "flag", kind: "boolean", defaultValue: 0 }),
      ]);
    });
    expect(result.current.inputValues.flag).toBe(true);
  });

  it("seeds boolean ids as boolean type, not number", () => {
    const { result } = setup();
    act(() => {
      result.current.onInputsRegistered([
        desc({ id: "enabled", kind: "boolean", defaultValue: 1 }),
      ]);
    });
    expect(result.current.inputValues.enabled).toBe(true);
  });
});
