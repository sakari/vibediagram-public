# VibeDiagram Modeling Guide

## What is VibeDiagram?

VibeDiagram is a browser-based tool for building and visualizing
discrete-event simulations. You write a TypeScript _model_ describing
the nodes in your system (caches, databases, load balancers, users…)
and the engine runs it in simulated time, rendering it as a live
node-edge diagram with metrics and adjustable inputs.

Typical uses: sketching system architectures, exploring "what if"
capacity questions, teaching distributed-systems concepts, or
prototyping before you build.

## What you'll see

- **Diagram pane** — nodes from `model.create()` with edges from `component.ref()`
- **Metrics** — counters, gauges, and summaries update live as the sim runs
- **Inputs** — sliders and toggles you wire up to tweak the model at runtime
- **Editor** — the `.ts` file that defines the model

A model is a TypeScript file that exports `model` from `createModel()`.
Nodes registered with `model.create()` become diagram elements.
References between nodes via `component.ref()` become edges.

If you learn better from examples, open `examples/cache.ts` or
`examples/loadbalancer.ts` alongside this guide.

## Your first model

Every model is a single TypeScript file. Here's the smallest one that
does something:

```typescript
import { Blueprint, createModel } from "@diagram/sim-model";

class Ping extends Blueprint {
  engineOnStart() {
    void this.run();
  }
  async run() {
    for (;;) {
      await this.engine.timeout(1);
      console.log("ping", this.engine.now());
    }
  }
}

export const model = createModel();
model.create("ping", Ping);
```

## Determinism and time simulation

The simulation engine controls time — it does not run in real time. All
timing goes through `this.engine.timeout(seconds)` which advances
simulated time. This means a model that takes hours of simulated time
runs in seconds of wall-clock time.

To keep simulations deterministic and reproducible:

- **Use `this.engine.timeout()`** instead of `setTimeout` or `setInterval`
- **Use `this.engine.random()`** instead of `Math.random()`
- **Do not create macrotasks** — no `setTimeout`, `setInterval`, `requestAnimationFrame`, or `new Worker()`
- **Microtasks are fine** — `Promise.resolve()`, `.then()`, `async/await` are all safe and deterministic

```typescript
// GOOD: deterministic timing and randomness
await this.engine.timeout(1);
const coin = this.engine.random();

// BAD: breaks determinism and time simulation
setTimeout(() => {}, 1000);
Math.random();
```

## Core concepts

### Node vs Blueprint

- `Node` — static element, no simulation logic, no engine access.
- `Blueprint extends Node` — has `this.engine` and lifecycle hooks
  (`engineOnStart`, `engineCheckInvariant`).
- Use Blueprint when you need timers, randomness, or dynamic spawning.
  Start with Blueprint unless you know you don't need simulation behavior.

### Params and topology

Declare params as a `static` field on the class using sentinel
factories, and add an instance mirror via `declare params: typeof
ClassName.params` so method bodies can read `this.params.*` with
full type safety. Each `component.ref()` creates a diagram edge from
this node to the referenced node.

```typescript
class Cache extends Blueprint {
  static params = {
    db: component.ref(Database), // edge: Cache -> Database
    hitRate: component.ref(metrics.Gauge), // edge: Cache -> hitRate gauge
    ttl: component.ref(InputNode), // edge: Cache -> ttl slider
  };

  declare params: typeof Cache.params;
}
```

### Wiring with model.create()

The third argument supplies concrete values for params as a plain
object. Params declared with a default at the `component.xxx(...)`
call site can be omitted — e.g. `component.ref(Database, (m, n) => …)`,
`component.capacity(10)`, `component.rate(100)` — and will be filled in
automatically.

A fourth `opts` argument carries display metadata (`label`,
`description`). Keep these out of the params object.

```typescript
const db = model.create("db", Database);
const hitRate = model.create<metrics.Gauge<"ratio">>("hitRate", metrics.Gauge, {
  unit: "ratio",
});
model.create(
  "cache",
  Cache,
  { db, hitRate },
  { description: "In-memory cache with TTL" },
);
```

### Circular references

When two nodes reference each other, create one first and use `.wire()`
to attach the back-edge after both exist:

```typescript
const queue = model.create("queue", Queue);
const producer = model.create("producer", Producer, { queue });
queue.wire({ producer });
```

Forward class references inside a `static params` schema use the
arrow form of `component.ref`:

```typescript
class A extends Blueprint {
  static params = { b: component.ref(() => B) };
  declare params: typeof A.params;
}
class B extends Blueprint {
  static params = { a: component.ref(A) };
  declare params: typeof B.params;
}
```

### Metrics

Three metric types for observability. See [metrics reference](reference/metrics.md) for full details.

- `metrics.Counter` — cumulative counts (requests, errors)
- `metrics.Gauge` — current value (utilization, queue depth)
- `metrics.Summary` — distributions (latency percentiles)

### Inputs

User-adjustable runtime parameters. See [inputs reference](reference/inputs.md) for full details.

### Distributions

Built-in stochastic distributions. See [distributions reference](reference/distributions.md) for full details.

### Built-in blueprints

Reusable building blocks. See [built-in blueprints reference](reference/builtin-blueprints.md) for full details.

### Engine API

Available on `this.engine` inside Blueprint methods:

- `timeout(seconds)` — async delay in simulated time
- `random()` — seeded pseudorandom [0, 1)
- `halt(reason)` — stop the simulation
- `now()` — current simulated time in seconds
- `spawn(name, Class, params?)` — create nodes dynamically at runtime;
  spawned nodes appear in the diagram as they are created

```typescript
// Dynamic spawning example
async scaleUp() {
  const worker = this.engine.spawn("worker-2", Worker, {
    pool: this.params.pool,
  });
}
```

### Style rules

Control how nodes look based on state, type, or topology.
See [styling reference](reference/styling.md) for full details.

## Common patterns

### Request-response with latency

```typescript
class Server extends Blueprint {
  static params = {
    link: component.ref(blueprints.LatencyBlueprint),
  };
  declare params: typeof Server.params;

  async handleRequest() {
    await this.params.link.delay(0);
    // process...
  }
}
```

### Periodic polling

```typescript
engineOnStart() { void this.poll(); }
async poll() {
  for (;;) {
    await this.engine.timeout(5);
    // check something...
  }
}
```

### Conditional routing

```typescript
async route(req: Request) {
  if (this.engine.random() < 0.1) {
    return this.params.canary.handle(req);
  }
  return this.params.primary.handle(req);
}
```

## File structure

A model is typically a single .ts file. The file must:

1. `import { ... } from "@diagram/sim-model"`
2. Define Blueprint/Node classes
3. Export `const model = createModel()`
4. Register nodes with `model.create()`
