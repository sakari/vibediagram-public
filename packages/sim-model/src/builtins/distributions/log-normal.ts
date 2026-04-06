import { component } from "../../sentinel";
import { Distribution } from "../../distribution";

export class LogNormal extends Distribution {
  params = { mu: component.capacity(), sigma: component.capacity() };
  /**
   * Returns a log-normally distributed sample.
   * mu and sigma are the mean and std-dev of the underlying normal.
   */
  draw(): number {
    const u1 = this.random();
    const u2 = this.random();
    const z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
    return Math.exp(this.params.mu + this.params.sigma * z);
  }
}
