# Built-in Blueprints Reference

The `blueprints` namespace provides reusable building blocks for
common distributed system patterns.

## LatencyBlueprint

Adds sampled delay to simulate network or processing latency.

**Params**: `{ latency: Distribution, metrics: Summary }`

```typescript
const dist = model.create("dist", distributions.Exponential, () => ({
  mean: 0.005,
}));
const latencyMetrics = model.create("latency", metrics.Summary);
const link = model.create("link", blueprints.LatencyBlueprint, () => ({
  latency: dist,
  metrics: latencyMetrics,
  description: "Database query latency",
}));

// In a Blueprint:
await this.params.link.delay(0);
// With utilization scaling: sample * (1 + utilization)
await this.params.link.delay(0.8);
```

## ResourcePool

Bounded resource pool with M/M/1 queuing model. Simulates connection
pools, thread pools, and similar bounded resources.

**Params** (all have defaults, auto-created if omitted):

- `capacity: InputNode` — pool size (default 10, range 1-100)
- `latency: Distribution` — base processing time (default Exponential mean=0.005)
- `scalingExponent: InputNode` — how sharply latency increases with utilization (default 1)
- `utilization: Gauge` — current utilization ratio
- `concurrentRequests: Gauge` — active request count

```typescript
const pool = model.create("pool", blueprints.ResourcePool, () => ({
  label: "Connection Pool",
}));

// In a Blueprint:
const release = await this.params.pool.acquire();
// ... do work ...
release();
```

The pool uses the formula: `scaled_latency = base_sample / (1 - utilization)^k`
where `k` is the scaling exponent. Requests queue in FIFO order when the pool is full.

## HttpServer (abstract)

Base class for HTTP request handlers. Extend and override `request()`.

```typescript
class Backend extends blueprints.HttpServer {
  params = {
    pool: component.ref(blueprints.ResourcePool),
  };

  async request(): Promise<HttpResponse> {
    const release = await this.params.pool.acquire();
    // process request...
    release();
    return { status: 200 };
  }
}
```

**HttpResponse**: `{ status: number, headers?: Record<string, string>, body?: string }`

**HttpMethod**: `"GET" | "POST" | "PUT" | "DELETE" | "PATCH"`

## HttpTrafficGeneratorBlueprint

Generates HTTP traffic with Poisson arrivals.

**Params**:

- `target: Blueprint` — where to send requests (required)
- `rate: InputNode` — requests per second (auto-created, default 0-100)
- `arrivalDistribution: Distribution` — inter-arrival time distribution (auto-created Exponential)
- `latency: Summary` — per-request latency metrics (auto-created)
- `statusCounts: Counter` — response status counts (auto-created)

```typescript
const gen = model.create(
  "traffic",
  blueprints.HttpTrafficGeneratorBlueprint,
  () => ({
    target: lb,
    rate: requestRate,
    label: "Traffic Generator",
  }),
);

gen.onRequest(async () => {
  return lb.request("GET", "/api/data");
});
```

Fires concurrent requests (fire-and-forget). Inter-arrival time is
`distribution.draw() / rate.value`.

## RoundRobinHttpLoadBalancer

Distributes HTTP requests across backends using round-robin.

**Params**: `{ backends: HttpServer[] }`

```typescript
const lb = model.create("lb", blueprints.RoundRobinHttpLoadBalancer, () => ({
  backends: [backend1, backend2, backend3],
  label: "Load Balancer",
}));

// Calling lb.request() distributes across backends sequentially
const response = await lb.request("GET", "/");
```
