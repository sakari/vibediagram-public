/**
 * InputNode: a mutable runtime value that the user can adjust via UI controls.
 * Extends Node so it participates in topology like any other node.
 * Created via model.create() and referenced via component.ref(InputNode).
 *
 * Value is always a number. For boolean inputs (kind "boolean"), the UI
 * interprets 0 as false and non-zero as true.
 */

import { component } from "./sentinel";
import { Node } from "./node";
import type { StyleRuleDescriptor } from "./style-rule-descriptor";

/** Describes an input control for serialisation and UI generation. */
export interface InputDescriptor {
  /** Unique identifier for this input (the registration name). */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Whether the control is numeric (slider) or boolean (toggle). */
  kind: "number" | "boolean";
  /** Minimum bound for numeric inputs. */
  min: number;
  /** Maximum bound for numeric inputs. */
  max: number;
  /** Step increment for numeric inputs. */
  step: number;
  /** Initial value before any user interaction. */
  defaultValue: number;
}

/**
 * Node representing a user-controllable input value.
 *
 * Created via model.create("name", InputNode, () => ({ kind, defaultValue, min, max, step })).
 * Blueprints reference it via component.ref(InputNode) in their params, then
 * read input.value at runtime.
 */
export class InputNode extends Node {
  static defaultStyleRules(): StyleRuleDescriptor[] {
    return [
      {
        name: "default-input-group",
        match: { type: "simInput" },
        style: { display: "group-child" },
      },
    ];
  }

  static params = {
    kind: component.param("number"),
    defaultValue: component.capacity(0),
    min: component.capacity(0),
    max: component.capacity(100),
    step: component.capacity(1),
  };

  declare params: typeof InputNode.params;

  private _value: number = 0;

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this._value = v;
  }
}
