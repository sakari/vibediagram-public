# API Quick Reference

## Imports

```typescript
import {
  Node,
  Blueprint,
  InputNode,
  component,
  createModel,
  metrics,
  distributions,
  blueprints,
  type StyleRuleDescriptor,
  type HttpResponse,
} from "@diagram/sim-model";
```

## component.\* (param declarations)

| Factory                            | Purpose                     | Auto-creates?            |
| ---------------------------------- | --------------------------- | ------------------------ |
| `component.ref(Class, factory?)`   | Reference to another node   | Yes, if factory provided |
| `component.capacity(default?)`     | Numeric capacity param      | —                        |
| `component.rate(default?)`         | Numeric rate param          | —                        |
| `component.duration(default?)`     | Numeric duration param      | —                        |
| `component.param(default?)`        | Generic param               | —                        |
| `component.array(inner, default?)` | Array of sentinels          | —                        |
| `component.record(shape)`          | Object with named sentinels | —                        |

## Node

```typescript
class MyNode extends Node {
  name: string; // set by framework
  static defaultStyleRules(): StyleRuleDescriptor[];
}
```

## Blueprint extends Node

```typescript
class MyBlueprint extends Blueprint {
  engine: Engine; // assigned at runtime
  engineOnStart(): void {} // simulation start hook
  engineCheckInvariant(): void {} // called after each tick
}
```

## Engine (via this.engine)

| Method                       | Returns         | Description                |
| ---------------------------- | --------------- | -------------------------- |
| `timeout(seconds)`           | `Promise<void>` | Delay in simulated time    |
| `random()`                   | `number`        | Seeded pseudorandom [0, 1) |
| `halt(reason)`               | `void`          | Stop simulation            |
| `spawn(name, Class, thunk?)` | `T`             | Create node at runtime     |
| `now()`                      | `number`        | Current sim time (seconds) |

## Metrics

| Class                 | Method                       | Snapshot type         |
| --------------------- | ---------------------------- | --------------------- |
| `metrics.Counter`     | `increment(labels, amount?)` | cumulative count      |
| `metrics.Gauge<Unit>` | `set(labels, value)`         | latest value          |
| `metrics.Summary`     | `observe(labels, value)`     | quantile distribution |

Units: `"count" | "byte" | "duration" | "ratio" | "timestamp"`

## InputNode

```typescript
model.create("name", InputNode, () => ({
  kind: "number" | "boolean",
  defaultValue: 50,
  min: 0,
  max: 100,
  step: 1,
  label: "Display Name",
}));
// Read: this.params.input.value
```

## Distributions

| Class                       | Params             |
| --------------------------- | ------------------ |
| `distributions.Exponential` | `{ mean }`         |
| `distributions.Uniform`     | `{ min, max }`     |
| `distributions.Normal`      | `{ mean, stddev }` |
| `distributions.LogNormal`   | `{ mu, sigma }`    |
| `distributions.Pareto`      | `{ scale, shape }` |

## Built-in Blueprints

| Class                                      | Key params          | Key methods                                    |
| ------------------------------------------ | ------------------- | ---------------------------------------------- |
| `blueprints.LatencyBlueprint`              | `latency, metrics`  | `delay(utilization?)`                          |
| `blueprints.ResourcePool`                  | `capacity, latency` | `acquire(): Promise<() => void>`               |
| `blueprints.HttpServer`                    | —                   | `request(method, path): Promise<HttpResponse>` |
| `blueprints.HttpTrafficGeneratorBlueprint` | `target, rate`      | `onRequest(handler)`                           |
| `blueprints.RoundRobinHttpLoadBalancer`    | `backends`          | inherits `request()`                           |

## Model builder

```typescript
const model = createModel();
const node = model.create("id", Class, () => ({
  ...paramValues,
  label: "Display Label",
  description: "Tooltip text",
}));
model.addStyleRules(rules);
export { model };
```

## StyleRuleDescriptor

```typescript
{
  name?: string,
  priority?: number,          // higher wins
  match: { id?, type?, data?: { className? }, topology?: { inDegree?, outDegree?, isGroup?, hasParent? } }
       | (node, graph) => boolean,
  style: { background?, borderColor?, borderWidth?, opacity?, boxShadow?, display?, groupInto? }
       | (node, graph) => StyleDescriptor,
}
```
