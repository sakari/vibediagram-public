/**
 * Round-robin HTTP load balancer: distributes incoming requests across a
 * list of HttpServer backends in sequential order. When the index wraps
 * past the last backend it starts again from the first.
 */

import { component } from "../../../sentinel";
import {
  HttpServer,
  type HttpMethod,
  type HttpRequestOpts,
  type HttpResponse,
} from "../http-server";

export class RoundRobinHttpLoadBalancer extends HttpServer {
  params = {
    backends: component.array(component.ref(HttpServer)),
  };

  // Tracks which backend receives the next request; wraps via modulo.
  private nextIndex = 0;

  async request(
    method: HttpMethod,
    path: string,
    opts?: HttpRequestOpts,
  ): Promise<HttpResponse> {
    const backends = this.params.backends;
    if (backends.length === 0) {
      throw new Error("RoundRobinHttpLoadBalancer: no backends configured");
    }
    const backend = backends[this.nextIndex % backends.length];
    this.nextIndex++;
    return backend.request(method, path, opts);
  }
}
