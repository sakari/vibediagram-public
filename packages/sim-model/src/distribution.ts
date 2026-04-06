import { Node } from "./node";
import { Engine } from "./blueprint";
import type { StyleRuleDescriptor } from "./style-rule-descriptor";

/**
 * Base class for all stochastic distribution components.
 * Extends Node: topology-visible, wirable via component.ref().
 *
 * `engine` is assigned by the engine during introspection, matching
 * the Blueprint.engine wiring pattern. Each distribution gets its own
 * per-node engine facade with a deterministically seeded random().
 */
export abstract class Distribution extends Node {
  static defaultStyleRules(): StyleRuleDescriptor[] {
    return [
      {
        name: "default-distribution-hidden",
        match: { data: { className: this.name } },
        style: { display: "hidden" },
      },
    ];
  }
  /**
   * Assigned by the engine during introspect(), before engineOnStart().
   * Use ! because wiring happens after construction, matching Blueprint.engine.
   */
  engine!: Engine;

  /** Returns a uniform random value in [0, 1). */
  protected random(): number {
    return this.engine.random();
  }

  /** Returns a sample from this distribution. All subclasses must implement this. */
  abstract draw(): number;

  /** Returns an exponentially distributed value with the given mean. */
  protected exponential(mean: number): number {
    return -mean * Math.log(1 - this.engine.random());
  }
}
