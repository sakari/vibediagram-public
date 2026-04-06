/**
 * HTTP traffic generator blueprint: models independently arriving requests via
 * a Poisson process (exponential inter-arrival times).
 *
 * Each request is sent as GET / to the target HttpServer. The generator
 * measures per-request latency using simulation time (p50/p95/p99 via a
 * Summary metric) and counts response statuses in a Counter metric.
 *
 * Wire `arrivalDistribution` to an Exponential distribution whose mean is
 * `1 / desired_rps` to get Poisson arrivals at that rate.
 */

import { Blueprint } from "../../../blueprint";
import { Distribution } from "../../../distribution";
import { InputNode } from "../../../input";
import { Counter, Summary } from "../../../metric";
import { component } from "../../../sentinel";
import { Exponential } from "../../distributions/exponential";
import { HttpServer } from "../http-server";

/**
 * Generates HTTP traffic by sampling inter-arrival times from a distribution
 * and sending GET / requests to the target HttpServer. Requests are
 * independent: each is fire-and-forget so concurrent requests overlap
 * naturally.
 */
export class HttpTrafficGeneratorBlueprint extends Blueprint {
  params = {
    /** Distribution for inter-arrival times. Defaults to Exponential(mean=1) for Poisson arrivals. */
    arrivalDistribution: component.ref(Distribution, (m, name) =>
      m.create(name, Exponential),
    ),
    /** Target request rate in requests per second (adjustable at runtime via slider). Defaults to InputNode(0, 0-100). */
    rate: component.ref(InputNode, (m, name) => m.create(name, InputNode)),
    /** Summary metric for per-request latency (p50/p95/p99). Defaults to standard Summary. */
    latency: component.ref(Summary, (m, name) => m.create(name, Summary)),
    /** Counter metric for response status counts (label: "status"). Defaults to standard Counter. */
    statusCounts: component.ref(Counter, (m, name) => m.create(name, Counter)),
    /** The target HttpServer that receives requests (creates a topology edge). No default — must be wired. */
    target: component.ref(HttpServer),
  };

  /** Starts the arrival loop when the engine begins. */
  engineOnStart(): void {
    void this.run();
  }

  /** Main arrival loop: draws inter-arrival times scaled by the rate and dispatches requests. */
  private async run(): Promise<void> {
    for (;;) {
      // Poisson inter-arrival: sample from unit distribution, scale by 1/rate
      const rate = this.params.rate.value;
      const sample = Math.max(0, this.params.arrivalDistribution.draw());
      const interArrival = rate > 0 ? sample / rate : sample;
      await this.engine.timeout(interArrival);

      // Fire-and-forget: each request runs concurrently so arrivals are independent
      void this.dispatchRequest();
    }
  }

  /** Dispatches a single request: calls the target, measures latency, records status. */
  private async dispatchRequest(): Promise<void> {
    const start = this.engine.now();
    let status: number;
    try {
      const response = await this.params.target.request("GET", "/");
      status = response.status;
    } catch {
      status = 500;
    }
    const elapsed = this.engine.now() - start;

    this.params.latency.observe({}, elapsed);
    this.params.statusCounts.increment({ status: String(status) });
  }
}
