import { component } from "../../sentinel";
import { Distribution } from "../../distribution";

export class Pareto extends Distribution {
  static params = { scale: component.capacity(), shape: component.capacity() };
  declare params: typeof Pareto.params;

  /**
   * Returns a Pareto-distributed sample using the inverse-CDF method.
   * scale (x_m) is the minimum value; shape (alpha) is the tail index.
   */
  draw(): number {
    return (
      this.params.scale / Math.pow(1 - this.random(), 1 / this.params.shape)
    );
  }
}
