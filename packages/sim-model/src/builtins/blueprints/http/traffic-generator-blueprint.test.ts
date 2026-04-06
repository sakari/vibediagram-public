import { describe, it, expect } from "vitest";
import { createModel } from "../../../model";
import { Exponential } from "../../distributions/exponential";
import { Counter, Summary } from "../../../metric";
import { InputNode } from "../../../input";
import { Engine } from "../../../blueprint";
import { createTestEngine } from "../../distributions/test-prng";
import { HttpTrafficGeneratorBlueprint } from "./traffic-generator-blueprint";
import { HttpServer, type HttpResponse } from "../http-server";
import { createEngine } from "@diagram/sim-default-engine";

/**
 * Builds a manually-wired HttpTrafficGeneratorBlueprint for unit testing.
 * The fake engine resolves timeouts immediately and tracks calls.
 * Sim time advances by the timeout amount so engine.now() returns accumulated time.
 */
class TestHttpServer extends HttpServer {
  handler: () => Promise<HttpResponse> = () => Promise.resolve({ status: 200 });

  override request(): Promise<HttpResponse> {
    return this.handler();
  }
}

function buildWired(seed: string, rate: number) {
  const model = createModel();

  const dist = model.create("arrival-dist", Exponential, () => ({
    mean: 1,
  }));

  const rateInput = model.create("rate", InputNode, () => ({
    kind: "number" as const,
    defaultValue: rate,
    min: 1,
    max: 200,
    step: 1,
  }));

  const latencyMetric = model.create<Summary<"duration">>(
    "req-latency",
    Summary,
    () => ({ unit: "duration", buckets: [0.5, 0.95, 0.99], capacity: 1000 }),
  );

  const statusMetric = model.create<Counter<"count", "status">>(
    "req-status",
    Counter,
    () => ({ unit: "count" }),
  );

  // Target HttpServer that handles requests
  const target = model.create("target", TestHttpServer, () => ({}));

  const generator = model.create(
    "traffic-gen",
    HttpTrafficGeneratorBlueprint,
    () => ({
      arrivalDistribution: dist,
      rate: rateInput,
      latency: latencyMetric,
      statusCounts: statusMetric,
      target,
    }),
  );

  // Wire distribution engine
  const distEngine = createTestEngine(seed + ":dist");
  dist.engine = distEngine;
  dist.params = { mean: 1 };

  // Wire rate InputNode (bypass createEngine, so set value manually)
  rateInput.params = {
    kind: "number" as const,
    defaultValue: rate,
    min: 1,
    max: 200,
    step: 1,
  };
  rateInput.value = rate;

  // Wire metric params manually (bypass createEngine)
  latencyMetric.params = {
    unit: "duration" as const,
    buckets: [0.5, 0.95, 0.99],
    capacity: 1000,
  };
  statusMetric.params = { unit: "count" as const };

  // Track timeouts; resolve them immediately so the run loop progresses.
  // Sim time accumulates so engine.now() returns the total elapsed time.
  const timeouts: number[] = [];
  let timeoutCount = 0;
  let maxTimeouts = 100;
  let rejectLoop: ((err: Error) => void) | undefined;
  let simTime = 0;

  const generatorEngine = new (class extends Engine {
    override timeout(seconds: number): Promise<void> {
      timeouts.push(seconds);
      simTime += seconds;
      timeoutCount++;
      // Stop the infinite loop after maxTimeouts arrivals
      if (timeoutCount > maxTimeouts) {
        return new Promise((_resolve, reject) => {
          rejectLoop = reject;
        });
      }
      return Promise.resolve();
    }
    override random(): number {
      return 0.5;
    }
    override now(): number {
      return simTime;
    }
  })();

  generator.engine = generatorEngine;
  generator.params = {
    arrivalDistribution: dist,
    rate: rateInput,
    latency: latencyMetric,
    statusCounts: statusMetric,
    target,
  };

  return {
    generator,
    target,
    dist,
    latencyMetric,
    statusMetric,
    timeouts,
    /** Set max arrivals before the loop blocks. */
    setMaxTimeouts: (n: number) => {
      maxTimeouts = n;
    },
    /** Stop the blocked loop (cleanup). */
    stopLoop: () => {
      rejectLoop?.(new Error("stopped"));
    },
  };
}

describe("HttpTrafficGeneratorBlueprint", () => {
  it("dispatches requests and records latency observations", async () => {
    const { generator, latencyMetric, setMaxTimeouts } = buildWired(
      "test1",
      40,
    );
    setMaxTimeouts(5);

    generator.engineOnStart();

    // Allow microtasks to settle (the run loop resolves timeouts synchronously)
    await new Promise((r) => setTimeout(r, 10));

    const snaps = latencyMetric.metrics();
    expect(snaps.length).toBeGreaterThan(0);

    // Should have quantile observations
    const p50 = snaps.find((s) => s.labels.quantile === "0.5");
    expect(p50).toBeDefined();
    expect(p50!.value.value).toBeGreaterThanOrEqual(0);
  });

  it("records response status counts", async () => {
    const { generator, target, statusMetric, setMaxTimeouts } = buildWired(
      "test2",
      40,
    );
    setMaxTimeouts(5);

    let callCount = 0;
    target.handler = () => {
      callCount++;
      // Alternate between 200 and 503
      return Promise.resolve({
        status: callCount % 2 === 0 ? 503 : 200,
      });
    };
    generator.engineOnStart();

    await new Promise((r) => setTimeout(r, 10));

    const snaps = statusMetric.metrics();
    expect(snaps.length).toBeGreaterThan(0);

    const status200 = snaps.find(
      (s) => s.value.type === "counter" && s.labels.status === "200",
    );
    const status503 = snaps.find(
      (s) => s.value.type === "counter" && s.labels.status === "503",
    );
    expect(status200).toBeDefined();
    expect(status200!.value.value).toBeGreaterThan(0);
    expect(status503).toBeDefined();
    expect(status503!.value.value).toBeGreaterThan(0);
  });

  it("treats target errors as 500 responses", async () => {
    const { generator, target, statusMetric, setMaxTimeouts } = buildWired(
      "test3",
      40,
    );
    setMaxTimeouts(3);

    target.handler = () => Promise.reject(new Error("backend crashed"));
    generator.engineOnStart();

    await new Promise((r) => setTimeout(r, 10));

    const snaps = statusMetric.metrics();
    const status500 = snaps.find(
      (s) => s.value.type === "counter" && s.labels.status === "500",
    );
    expect(status500).toBeDefined();
    expect(status500!.value.value).toBeGreaterThan(0);
  });

  it("clamps negative inter-arrival times to zero", async () => {
    const { generator, timeouts, setMaxTimeouts } = buildWired("test5", 0.025);
    setMaxTimeouts(3);

    generator.engineOnStart();

    await new Promise((r) => setTimeout(r, 10));

    // All timeouts should be non-negative
    for (const t of timeouts) {
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses inter-arrival times drawn from the distribution", async () => {
    const { generator, timeouts, setMaxTimeouts } = buildWired("test6", 10);
    setMaxTimeouts(10);

    generator.engineOnStart();

    await new Promise((r) => setTimeout(r, 10));

    // With exponential distribution, draws should vary
    expect(timeouts.length).toBeGreaterThan(0);
    // All should be positive (exponential with positive mean)
    for (const t of timeouts) {
      expect(t).toBeGreaterThan(0);
    }
  });
});

describe("HttpTrafficGeneratorBlueprint defaults", () => {
  it("can be created with only target — other params use ref defaults", () => {
    const model = createModel();
    const target = model.create("target", HttpServer, () => ({}));

    model.create("gen", HttpTrafficGeneratorBlueprint, () => ({
      target,
    }));

    const controller = createEngine(model, { seed: "defaults", duration: 0 });

    // Verify auto-created nodes exist in registrations
    const names = controller.registrations.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "gen",
        "gen/arrivalDistribution",
        "gen/rate",
        "gen/latency",
        "gen/statusCounts",
      ]),
    );
  });
});
