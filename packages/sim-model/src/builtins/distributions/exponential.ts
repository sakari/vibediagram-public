import { component } from "../../sentinel";
import { Distribution } from "../../distribution";

export class Exponential extends Distribution {
  params = { mean: component.capacity(1) };
  /** Returns an exponentially distributed sample with the given mean. */
  draw(): number {
    return this.exponential(this.params.mean);
  }
}
