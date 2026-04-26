import { component } from "../../sentinel";
import { Distribution } from "../../distribution";

export class Normal extends Distribution {
  static params = { mean: component.capacity(), stddev: component.capacity() };
  declare params: typeof Normal.params;

  /**
   * Returns a normally distributed sample (Box-Muller transform).
   * Consumes two uniform draws per call.
   */
  draw(): number {
    const u1 = this.random();
    const u2 = this.random();
    const z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
    return this.params.mean + this.params.stddev * z;
  }
}
