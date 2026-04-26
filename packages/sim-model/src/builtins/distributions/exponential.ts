import { component } from "../../sentinel";
import { Distribution } from "../../distribution";

export class Exponential extends Distribution {
  static params = { mean: component.capacity(1) };
  declare params: typeof Exponential.params;

  /** Returns an exponentially distributed sample with the given mean. */
  draw(): number {
    return this.exponential(this.params.mean);
  }
}
