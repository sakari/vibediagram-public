import {
  InputNode,
  component,
  createModel,
  metrics,
  blueprints,
  type HttpResponse,
  type StyleRuleDescriptor,
} from "@diagram/sim-model";

class Backend extends blueprints.HttpServer {
  static params = {
    pool: component.ref(blueprints.ResourcePool),
    qps: component.ref(metrics.Counter, (m, name) =>
      m.create(name, metrics.Counter),
    ),
  };

  declare params: typeof Backend.params;

  async request(): Promise<HttpResponse> {
    const result = await this.params.pool.use<HttpResponse>(
      () => {
        this.params.qps.increment({});
        return { status: 200 };
      },
      { timeout: 5 },
    );
    return result ?? { status: 503 };
  }
}

export const model = createModel();

// Target request rate (requests per second), adjustable via slider
const requestRate = model.create(
  "request-rate",
  InputNode,
  { kind: "number", defaultValue: 40, min: 1, max: 200, step: 1 },
  { label: "Request Rate" },
);

// Create 2 backend servers — all params use defaults:
// Backend: pool (ResourcePool) and qps (Counter) auto-created
// ResourcePool: capacity, latency, scalingExponent, utilization, concurrentRequests, latencyMetrics
const backends: Backend[] = [];
for (let i = 0; i < 2; i++) {
  const id = `backend-${String(i)}`;
  const pool = model.create(
    `${id}-pool`,
    blueprints.ResourcePool,
    {},
    { label: `Resource Pool ${String(i + 1)}` },
  );
  const backend = model.create(
    id,
    Backend,
    { pool },
    {
      label: `Backend Server ${String(i + 1)}`,
      description: "Processes HTTP requests using a bounded resource pool",
    },
  );
  backends.push(backend);
}

// Load balancer — backends wired via params, visible in topology
const lb = model.create(
  "loadBalancer",
  blueprints.RoundRobinHttpLoadBalancer,
  { backends },
  {
    label: "Load Balancer",
    description: "Distributes requests across backends using round-robin",
  },
);

// HTTP traffic generator — only target and rate need explicit wiring;
// arrivalDistribution (Exponential mean=1), latency (Summary), and
// statusCounts (Counter) use defaults.
model.create(
  "trafficGenerator",
  blueprints.HttpTrafficGeneratorBlueprint,
  { rate: requestRate, target: lb },
  {
    label: "Traffic Generator",
    description:
      "Sends HTTP requests at a configurable rate using Poisson arrivals",
  },
);

// ---------------------------------------------------------------------------
// Style rules
// ---------------------------------------------------------------------------

const styles: StyleRuleDescriptor[] = [
  // Highlight overloaded backends (utilization > 80%) with visible colors
  {
    name: "backend-overloaded",
    priority: 10,
    match: (node) =>
      node.id.startsWith("backend-") && !node.id.includes("-", 8),
    style: (node) => {
      const util = node.metric(`${node.id}-pool/utilization`) ?? 0;
      if (util > 0.8) {
        return {
          background: "#4a1a1a",
          borderColor: "#e74c3c",
          borderWidth: 2,
          boxShadow: "0 0 8px rgba(231, 76, 60, 0.5)",
          shape: "hexagon",
        };
      }
      if (util > 0.5) {
        return {
          background: "#4a3a1a",
          borderColor: "#f1c40f",
          borderWidth: 2,
          boxShadow: "0 0 6px rgba(241, 196, 15, 0.3)",
          shape: "hexagon",
        };
      }
      return {
        background: "#1a4a2a",
        borderColor: "#2ecc71",
        borderWidth: 2,
        shape: "hexagon",
      };
    },
  },

  // Load balancer node styling — strong blue accent
  {
    name: "lb-style",
    match: { id: "loadBalancer" },
    style: {
      borderColor: "#3498db",
      background: "#1a3050",
      borderWidth: 2,
      boxShadow: "0 0 6px rgba(52, 152, 219, 0.3)",
      shape: "diamond",
    },
  },

  // Traffic generator styling — strong purple accent
  {
    name: "traffic-gen-style",
    match: { id: "trafficGenerator" },
    style: {
      borderColor: "#9b59b6",
      background: "#3a1a50",
      borderWidth: 2,
      boxShadow: "0 0 6px rgba(155, 89, 182, 0.3)",
      shape: "circle",
    },
  },
];

model.addStyleRules(styles);
