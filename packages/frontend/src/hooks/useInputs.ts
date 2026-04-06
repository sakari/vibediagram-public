import { useState, useCallback, type RefObject } from "react";
import type { InputDescriptor } from "@diagram/sim-model";
import type { SimWorkerBridge } from "@diagram/sim-worker";

/**
 * Return shape of {@link useInputs}.
 *
 * The hook owns the "registered simulation inputs" concern:
 *  - `inputDescriptors` is the list of descriptors last reported by the worker.
 *  - `inputValues` is the frontend-owned map of current input values. It is
 *    the single source of truth across engine rebuilds: user edits live here
 *    and are replayed into each new engine via the init request.
 *  - `setInputValue` updates `inputValues` and forwards the change to the
 *    worker bridge (so a live engine, if any, sees it immediately).
 *  - `onInputsRegistered` is the callback to wire into the bridge so the
 *    worker can publish freshly registered descriptors. New ids are seeded
 *    into `inputValues` from `defaultValue`; existing entries are preserved.
 *  - `resetInputs` clears local state (used on sim reset).
 */
interface UseInputsResult {
  inputDescriptors: InputDescriptor[];
  inputValues: Record<string, number | boolean>;
  setInputValue: (id: string, value: number | boolean) => void;
  onInputsRegistered: (inputs: InputDescriptor[]) => void;
  resetInputs: () => void;
}

/**
 * React hook that owns the state of simulation inputs registered by the
 * worker. `useSimulation` composes this hook and re-exports its fields so
 * callers have a single cohesive place to find input-related logic.
 *
 * The hook is intentionally decoupled from the worker lifecycle: it takes a
 * ref to the active bridge rather than creating one, so the bridge can be
 * swapped (e.g. on re-init) without resetting the hook.
 */
export function useInputs(
  bridgeRef: RefObject<SimWorkerBridge | null>,
): UseInputsResult {
  const [inputDescriptors, setInputDescriptors] = useState<InputDescriptor[]>(
    [],
  );
  const [inputValues, setInputValues] = useState<
    Record<string, number | boolean>
  >({});

  const setInputValue = useCallback(
    (id: string, value: number | boolean) => {
      // Write to the frontend-owned source of truth first, then forward.
      // The map survives engine rebuilds; the forward keeps a live engine
      // (if any) in sync in the meantime.
      setInputValues((prev) => ({ ...prev, [id]: value }));
      bridgeRef.current?.setInputValue(id, value);
    },
    [bridgeRef],
  );

  const onInputsRegistered = useCallback((inputs: InputDescriptor[]) => {
    setInputDescriptors(inputs);
    // Reconcile inputValues against the fresh descriptor list:
    //  - Prune ids that no longer exist in the model.
    //  - Reset entries whose kind changed (number↔boolean).
    //  - Clamp numeric values to [min, max] and snap to step.
    //  - Seed new ids from defaultValue.
    setInputValues((prev) => {
      const next: Record<string, number | boolean> = {};
      for (const d of inputs) {
        const existing = d.id in prev ? prev[d.id] : undefined;
        if (existing === undefined) {
          // New id — seed from default.
          next[d.id] =
            d.kind === "boolean" ? d.defaultValue !== 0 : d.defaultValue;
        } else if (
          (d.kind === "boolean" && typeof existing === "number") ||
          (d.kind === "number" && typeof existing === "boolean")
        ) {
          // Kind changed — reset to default rather than coercing silently.
          next[d.id] =
            d.kind === "boolean" ? d.defaultValue !== 0 : d.defaultValue;
        } else if (d.kind === "number" && typeof existing === "number") {
          // Clamp to new bounds and snap to step.
          const clamped = Math.min(d.max, Math.max(d.min, existing));
          const snapped =
            d.step > 0
              ? d.min + Math.round((clamped - d.min) / d.step) * d.step
              : clamped;
          next[d.id] = Math.min(d.max, snapped); // guard rounding overshoot
        } else {
          // Boolean, same kind — preserve as-is.
          next[d.id] = existing;
        }
      }
      return next;
    });
  }, []);

  const resetInputs = useCallback(() => {
    setInputDescriptors([]);
    setInputValues({});
  }, []);

  return {
    inputDescriptors,
    inputValues,
    setInputValue,
    onInputsRegistered,
    resetInputs,
  };
}
