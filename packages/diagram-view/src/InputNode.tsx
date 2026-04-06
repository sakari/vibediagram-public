import { Handle, Position } from "@xyflow/react";
import type { DiagramNodeComponentProps } from "./types";

/** Callback shape for value changes from an input node. */
type ValueChangeCallback = (id: string, value: number | boolean) => void;

/** Extract a numeric field from the data bag, with a fallback. */
function numField(
  data: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const v = data?.[key];
  return typeof v === "number" ? v : fallback;
}

/**
 * Read the controlling numeric value from the data bag. Prefers `value`
 * (frontend-owned source of truth) and falls back to `defaultValue`. Returns
 * `undefined` when neither is a usable number so the caller can pick its own
 * fallback.
 */
function controlledNumValue(
  data: Record<string, unknown> | undefined,
): number | undefined {
  const v = data?.value;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const d = data?.defaultValue;
  if (typeof d === "number") return d;
  if (typeof d === "boolean") return d ? 1 : 0;
  return undefined;
}

/**
 * Read the controlling boolean value from the data bag. Prefers `value`
 * (frontend-owned source of truth) and falls back to `defaultValue`.
 * Numeric values are interpreted as booleans (0 = false, non-zero = true).
 */
function controlledBoolValue(
  data: Record<string, unknown> | undefined,
): boolean {
  const v = data?.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const d = data?.defaultValue;
  if (typeof d === "boolean") return d;
  if (typeof d === "number") return d !== 0;
  return false;
}

/** Compute the number of decimal places from a step value (e.g. 0.05 -> 2). */
function stepPrecision(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Type guard for ValueChangeCallback. */
function isValueChangeCallback(v: unknown): v is ValueChangeCallback {
  return typeof v === "function";
}

/** Extract the onValueChange callback if it is a function. */
function getValueChangeCallback(
  data: Record<string, unknown> | undefined,
): ValueChangeCallback | undefined {
  const fn = data?.onValueChange;
  return isValueChangeCallback(fn) ? fn : undefined;
}

/**
 * Slider control for numeric input kind.
 *
 * Fully controlled: the displayed value comes from the `value` prop, which
 * the parent (DiagramWorkspace) sources from its own `inputValues` map so
 * user edits persist across engine rebuilds. The slider never holds local
 * state — on interaction it forwards the new value via `onValueChange` and
 * waits for the parent to echo it back through `value`.
 */
function SliderControl({
  id,
  min,
  max,
  step,
  value,
  onValueChange,
}: {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onValueChange: ValueChangeCallback | undefined;
}) {
  const precision = stepPrecision(step);

  return (
    <div className="nodrag nopan">
      <div
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: "#e0e0e0",
          fontSize: 12,
          marginBottom: 2,
        }}
        data-testid="slider-value"
      >
        {value.toFixed(precision)}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          onValueChange?.(id, v);
        }}
        style={{ width: "100%" }}
        data-testid="input-slider"
      />
    </div>
  );
}

/**
 * Checkbox control for boolean input kind. Fully controlled via `value`
 * prop — see {@link SliderControl} for the rationale.
 */
function ToggleControl({
  id,
  value,
  onValueChange,
}: {
  readonly id: string;
  readonly value: boolean;
  readonly onValueChange: ValueChangeCallback | undefined;
}) {
  return (
    <div
      className="nodrag nopan"
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => {
          onValueChange?.(id, e.target.checked);
        }}
        data-testid="input-toggle"
      />
      <span>{value ? "ON" : "OFF"}</span>
    </div>
  );
}

/**
 * Interactive input node for use inside React Flow diagrams.
 *
 * Renders either a range slider (for numeric inputs) or a checkbox toggle
 * (for boolean inputs). Wraps controls in `className="nodrag nopan"` so
 * React Flow does not intercept pointer events on the interactive elements.
 *
 * Controlled via `data.onValueChange(id, value)` callback — the parent
 * wiring (e.g. DiagramWorkspace) is responsible for feeding the new value
 * back into the simulation engine.
 */
export function InputNode({ id, data }: DiagramNodeComponentProps) {
  const label = typeof data?.label === "string" ? data.label : "";
  const description =
    typeof data?.description === "string" && data.description.length > 0
      ? data.description
      : undefined;
  const inputKind = data?.inputKind === "boolean" ? "boolean" : "number";
  const onValueChange = getValueChangeCallback(data);

  return (
    <div
      data-testid="input-node"
      style={{
        padding: "8px 16px",
        borderRadius: 4,
        border: "1px solid #4a4a6a",
        background: "#1e1e2e",
        color: "#e0e0e0",
        fontSize: 13,
        minWidth: 200,
        minHeight: 70,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ marginBottom: 4, fontWeight: 600 }}>
        {description ? (
          <span className="diagram-label-hint" title={description}>
            {label}
          </span>
        ) : (
          label
        )}
      </div>

      {inputKind === "boolean" ? (
        <ToggleControl
          id={id}
          value={controlledBoolValue(data)}
          onValueChange={onValueChange}
        />
      ) : (
        <SliderControl
          id={id}
          min={numField(data, "min", 0)}
          max={numField(data, "max", 100)}
          step={numField(data, "step", 1)}
          value={controlledNumValue(data) ?? 50}
          onValueChange={onValueChange}
        />
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
