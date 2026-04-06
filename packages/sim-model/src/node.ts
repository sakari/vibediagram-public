import type { StyleRuleDescriptor } from "./style-rule-descriptor";

/**
 * Base class for all simulation components. Nodes have no lifecycle and no
 * engine access. The framework sets `name` via model.create; subclasses declare
 * params using sentinel-bearing objects.
 */
export class Node {
  /** Set by the framework during model.create; never by user code. */
  name = "";

  /**
   * Static style rules collected once per class, matching all instances of this
   * Node type. Override in subclasses to provide class-wide default styles.
   *
   * All default rules run at lower priority than rules added via
   * `model.addStyleRules()`.
   */
  static defaultStyleRules(): StyleRuleDescriptor[] {
    return [];
  }
}
