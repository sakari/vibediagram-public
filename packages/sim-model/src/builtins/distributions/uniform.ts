import { component } from "../../sentinel";
import { Distribution } from "../../distribution";

export class Uniform extends Distribution {
  params = { min: component.capacity(), max: component.capacity() };
  /** Returns a sample uniformly distributed in [min, max). */
  draw(): number {
    return (
      this.params.min + (this.params.max - this.params.min) * this.random()
    );
  }
}
