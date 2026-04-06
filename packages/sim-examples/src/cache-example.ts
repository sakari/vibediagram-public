import {
  Blueprint,
  InputNode,
  component,
  createModel,
  distributions,
  metrics,
  blueprints,
  type StyleRuleDescriptor,
} from "@diagram/sim-model";

class Cache extends Blueprint {
  params = {
    hitRateGauge: component.ref(metrics.Gauge),
    requests: component.ref(metrics.Counter),
    cacheLink: component.ref(blueprints.LatencyBlueprint),
    dbLink: component.ref(blueprints.LatencyBlueprint),
    hitRatio: component.ref(InputNode),
  };

  private hits = 0;
  private total = 0;

  engineOnStart() {}

  async handleRequest() {
    this.total++;
    this.params.requests.increment({});

    // Decide hit/miss using the configured hit ratio input
    const ratio = this.params.hitRatio.value;
    const isHit = this.engine.random() < ratio;

    if (isHit) {
      this.hits++;
      // Cache hit: fast local lookup
      await this.params.cacheLink.delay(0);
    } else {
      // Cache miss: forward to database (slower)
      await this.params.dbLink.delay(0);
    }

    // Update observed hit rate gauge
    this.params.hitRateGauge.set(
      {},
      this.total > 0 ? this.hits / this.total : 0,
    );
  }
}

class AppServer extends Blueprint {
  params = {
    cache: component.ref(Cache),
  };

  engineOnStart() {
    void this.generateRequests();
  }

  async generateRequests() {
    for (;;) {
      await this.engine.timeout(1 / 50);
      void this.params.cache.handleRequest();
    }
  }
}

export const model = createModel();

// Configurable hit ratio (0.0 to 1.0)
const hitRatio = model.create("hitRatio", InputNode, () => ({
  kind: "number",
  defaultValue: 0.7,
  min: 0,
  max: 1,
  step: 0.05,
}));

// Metrics
const hitRateGauge = model.create<metrics.Gauge<"ratio">>(
  "hitRate",
  metrics.Gauge,
  () => ({
    unit: "ratio",
  }),
);
const requests = model.create("requests", metrics.Counter);
const cacheLatency = model.create("cacheLatency", metrics.Summary);
const dbLatency = model.create("dbLatency", metrics.Summary);

// Latency distributions
const cacheDist = model.create("cacheDist", distributions.Exponential, () => ({
  mean: 0.001,
}));
const dbDist = model.create("dbDist", distributions.Exponential, () => ({
  mean: 0.01,
}));

// Latency links
const cacheLink = model.create(
  "cacheLink",
  blueprints.LatencyBlueprint,
  () => ({
    latency: cacheDist,
    metrics: cacheLatency,
    description: "Simulates cache lookup latency",
  }),
);
const dbLink = model.create("dbLink", blueprints.LatencyBlueprint, () => ({
  latency: dbDist,
  metrics: dbLatency,
}));

// Cache component
const cache = model.create("cache", Cache, () => ({
  hitRateGauge,
  requests,
  cacheLink,
  dbLink,
  hitRatio,
  description: "Caches responses; hits are fast, misses go to the database",
}));

// App server drives traffic
model.create("appServer", AppServer, () => ({
  cache,
  description: "Generates a steady stream of requests to the cache",
}));

// ---------------------------------------------------------------------------
// Style rules
// ---------------------------------------------------------------------------

const styles: StyleRuleDescriptor[] = [
  // Cache turns green when hit rate is high, red when low
  {
    name: "cache-healthy",
    priority: 10,
    match: { id: "cache" },
    style: (node) => {
      const rate = node.metric("hitRate") ?? 0;
      if (rate > 0.8) {
        return {
          background: "#1a3a2a",
          borderColor: "#2ecc71",
          shape: "cylinder",
        };
      }
      if (rate < 0.5) {
        return {
          background: "#3a1a1a",
          borderColor: "#e74c3c",
          shape: "cylinder",
        };
      }
      return {
        background: "#2a2a1a",
        borderColor: "#f1c40f",
        shape: "cylinder",
      };
    },
  },
];

model.addStyleRules(styles);
