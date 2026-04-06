/**
 * Builtin latency blueprint: models latency as a delay sampled from a
 * pluggable distribution. Other blueprints wire it via component.ref() and
 * await delay() to introduce latency into the simulation.
 */

import { Blueprint } from "../../blueprint";
import { Distribution } from "../../distribution";
import { Summary } from "../../metric";
import { component } from "../../sentinel";

export class LatencyBlueprint extends Blueprint {
  params = {
    latency: component.ref(Distribution),
    metrics: component.ref(Summary),
  };

  /**
   * Samples the wired distribution, scales by utilization, records the
   * observation to the Summary metric, and advances simulation time.
   *
   * The scaling formula is `sample * (1 + utilization)`: at zero utilization
   * the delay equals the raw distribution sample; at full utilization (1.0)
   * the delay doubles. Negative samples are clamped to zero.
   */
  async delay(utilization = 0): Promise<void> {
    const sample = this.params.latency.draw();
    const scaled = Math.max(0, sample * (1 + utilization));
    this.params.metrics.observe({}, scaled);
    await this.engine.timeout(scaled);
  }
}
