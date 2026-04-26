import { describe, it, expect } from "vitest";
import { createModel } from "../../../model";
import { Engine } from "../../../blueprint";
import { RoundRobinHttpLoadBalancer } from "./round-robin-http";
import {
  HttpServer,
  type HttpMethod,
  type HttpRequestOpts,
  type HttpResponse,
} from "../http-server";

/** Test backend that records calls and returns an identifiable response. */
class TestBackend extends HttpServer {
  readonly calls: Array<{
    method: HttpMethod;
    path: string;
    opts?: HttpRequestOpts;
  }> = [];

  constructor(private readonly id: string) {
    super();
  }

  override request(
    method: HttpMethod,
    path: string,
    opts?: HttpRequestOpts,
  ): Promise<HttpResponse> {
    this.calls.push({ method, path, opts });
    return Promise.resolve({ status: 200, body: { backend: this.id } });
  }
}

/** Builds a load balancer wired to the given number of TestBackend instances. */
function buildLB(backendCount: number) {
  const model = createModel();
  const backends: TestBackend[] = [];

  for (let i = 0; i < backendCount; i++) {
    const b = new TestBackend(`backend-${String(i)}`);
    b.name = `backend-${String(i)}`;
    backends.push(b);
  }

  const lb = model.create("lb", RoundRobinHttpLoadBalancer, {
    backends,
  });

  // Wire a no-op engine — round-robin request() does not use engine methods.
  lb.engine = new Engine();
  lb.params = { backends };

  return { lb, backends };
}

describe("HttpServer", () => {
  it("base request() throws when not overridden", () => {
    const server = new HttpServer();
    expect(() => server.request("GET", "/")).toThrow("not implemented");
  });
});

describe("RoundRobinHttpLoadBalancer", () => {
  it("cycles through backends in round-robin order", async () => {
    const { lb, backends } = buildLB(3);
    for (let i = 0; i < 6; i++) {
      const res = await lb.request("GET", "/health");
      // Each backend returns { backend: "backend-N" } — verify round-robin order.
      expect(res.body).toEqual({ backend: `backend-${String(i % 3)}` });
    }

    // Each backend received exactly 2 requests.
    for (const b of backends) {
      expect(b.calls).toHaveLength(2);
    }
  });

  it("forwards method, path, and opts to the selected backend", async () => {
    const { lb, backends } = buildLB(1);

    const opts: HttpRequestOpts = {
      headers: { Authorization: "Bearer token" },
      query: { page: "2" },
      body: { data: "payload" },
    };
    await lb.request("POST", "/api/items", opts);

    const firstBackend = backends[0];
    expect(firstBackend.calls[0]).toEqual(
      expect.objectContaining({
        method: "POST",
        path: "/api/items",
        opts,
      }),
    );
  });

  it("returns the backend's HttpResponse including status, headers, and body", async () => {
    // Create a backend that returns a rich response.
    class RichBackend extends HttpServer {
      override request(): Promise<HttpResponse> {
        return Promise.resolve({
          status: 201,
          headers: { "Content-Type": "application/json" },
          body: { created: true },
        });
      }
    }

    const model = createModel();
    const backend = new RichBackend();
    backend.name = "rich";

    const lb = model.create("lb", RoundRobinHttpLoadBalancer, {
      backends: [backend],
    });
    lb.engine = new Engine();
    lb.params = { backends: [backend] };

    const response = await lb.request("PUT", "/resource/1");

    expect(response).toEqual(
      expect.objectContaining({
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: { created: true },
      }),
    );
  });

  it("throws when backends array is empty", async () => {
    const model = createModel();
    const lb = model.create("lb", RoundRobinHttpLoadBalancer, {
      backends: [],
    });
    lb.engine = new Engine();
    lb.params = { backends: [] };

    await expect(lb.request("GET", "/")).rejects.toThrow(
      "no backends configured",
    );
  });
});
