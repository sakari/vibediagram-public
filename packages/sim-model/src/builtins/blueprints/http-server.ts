/**
 * Base class for HTTP-speaking simulation nodes. Subclasses override
 * request() to model servers, proxies, or load balancers that route,
 * transform, or respond to HTTP traffic within a simulation.
 */

import { Blueprint } from "../../blueprint";

/** HTTP methods supported by the simulation HTTP layer. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** Options bag passed to an HTTP request (headers, query string, body). */
export interface HttpRequestOpts {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

/** Simplified HTTP response returned by HttpServer.request(). */
export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Abstract-ish base for any node that speaks HTTP. Provides a single
 * `request()` entry point that subclasses override to model concrete
 * server behaviour. The default implementation throws so that forgetting
 * to override is caught immediately at runtime.
 */
export class HttpServer extends Blueprint {
  request(
    _method: HttpMethod,
    _path: string,
    _opts?: HttpRequestOpts,
  ): Promise<HttpResponse> {
    throw new Error(
      "HttpServer.request() not implemented — override in subclass",
    );
  }
}
