import { bench, describe } from "vitest";
import { Exponential } from "./builtins/distributions/exponential";
import { Normal } from "./builtins/distributions/normal";
import { LogNormal } from "./builtins/distributions/log-normal";
import { Pareto } from "./builtins/distributions/pareto";
import { Uniform } from "./builtins/distributions/uniform";
import { createTestEngine } from "./builtins/distributions/test-prng";

function wireDist<
  T extends { engine: unknown; params: Record<string, unknown> },
>(dist: T, params: Record<string, unknown>, seed: string): T {
  dist.engine = createTestEngine(seed);
  Object.assign(dist.params, params);
  return dist;
}

describe("Distribution sampling x10k", () => {
  bench("Exponential", () => {
    const d = wireDist(new Exponential(), { mean: 0.005 }, "bench-exp");
    for (let i = 0; i < 10_000; i++) d.draw();
  });

  bench("Normal", () => {
    const d = wireDist(new Normal(), { mean: 0, stddev: 1 }, "bench-norm");
    for (let i = 0; i < 10_000; i++) d.draw();
  });

  bench("LogNormal", () => {
    const d = wireDist(new LogNormal(), { mu: 0, sigma: 1 }, "bench-lnorm");
    for (let i = 0; i < 10_000; i++) d.draw();
  });

  bench("Pareto", () => {
    const d = wireDist(new Pareto(), { scale: 1, shape: 2 }, "bench-pareto");
    for (let i = 0; i < 10_000; i++) d.draw();
  });

  bench("Uniform", () => {
    const d = wireDist(new Uniform(), { min: 0, max: 1 }, "bench-unif");
    for (let i = 0; i < 10_000; i++) d.draw();
  });
});
