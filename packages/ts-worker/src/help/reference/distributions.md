# Distributions Reference

Distributions provide seeded pseudorandom sampling for stochastic
modeling. They extend `Node` and use `this.engine` for deterministic
random number generation.

## Built-in distributions

### Exponential

Memoryless distribution, commonly used for inter-arrival times.

```typescript
const dist = model.create("arrivalDist", distributions.Exponential, () => ({
  mean: 0.01, // average value
}));
```

### Uniform

Equal probability across a range.

```typescript
const dist = model.create("jitter", distributions.Uniform, () => ({
  min: 0.001,
  max: 0.005,
}));
```

### Normal (Gaussian)

Bell curve distribution.

```typescript
const dist = model.create("latency", distributions.Normal, () => ({
  mean: 0.05,
  stddev: 0.01,
}));
```

### LogNormal

Skewed distribution, useful for latency modeling.

```typescript
const dist = model.create("responseTime", distributions.LogNormal, () => ({
  mu: -3, // log-space mean
  sigma: 0.5, // log-space standard deviation
}));
```

### Pareto

Heavy-tailed distribution for modeling outliers.

```typescript
const dist = model.create("payloadSize", distributions.Pareto, () => ({
  scale: 1.0, // minimum value
  shape: 2.0, // tail heaviness (lower = heavier tail)
}));
```

## Using distributions with LatencyBlueprint

The most common use is pairing a distribution with `blueprints.LatencyBlueprint`:

```typescript
const dist = model.create("dbDist", distributions.Exponential, () => ({
  mean: 0.005,
}));
const latencyMetrics = model.create("dbLatency", metrics.Summary);
const dbLink = model.create("dbLink", blueprints.LatencyBlueprint, () => ({
  latency: dist,
  metrics: latencyMetrics,
}));

// In a Blueprint:
await this.params.dbLink.delay(0); // samples from dist, records to metrics
```

## Custom distributions

Extend the `Distribution` base class:

```typescript
class Bimodal extends Distribution {
  params = {
    fast: component.ref(distributions.Normal),
    slow: component.ref(distributions.Normal),
  };

  draw(): number {
    if (this.random() < 0.9) {
      return this.params.fast.draw();
    }
    return this.params.slow.draw();
  }
}
```
