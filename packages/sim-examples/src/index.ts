export { model as cacheModel } from "./cache-example";
export { model as loadBalancerModel } from "./loadbalancer-example";
export { model as shapesModel } from "./shapes-example";
export { model as workerPoolModel } from "./worker-pool-example";

/** Metadata for example projects. Source content is loaded separately via ?raw imports. */
export interface ExampleMeta {
  id: string;
  title: string;
  description: string;
  /** Package export path for the raw source (used with Vite ?raw import) */
  sourceExport: string;
}

export const exampleProjects: ExampleMeta[] = [
  {
    id: "cache-layer",
    title: "Cache Layer",
    description:
      "Application server with cache and database backend. Shows cache hit/miss logic and conditional styling.",
    sourceExport: "@diagram/sim-examples/cache-example-source",
  },
  {
    id: "load-balancer",
    title: "Load Balancer",
    description:
      "Load balancer distributing traffic across multiple backend servers with round-robin routing.",
    sourceExport: "@diagram/sim-examples/loadbalancer-example-source",
  },
  {
    id: "worker-pool",
    title: "Worker Pool",
    description:
      "Supervisor spawns workers on demand as a queue backs up. Crank the arrival rate to watch workers appear and drain the backlog.",
    sourceExport: "@diagram/sim-examples/worker-pool-example-source",
  },
  {
    id: "all-shapes",
    title: "All Shapes",
    description:
      "Demonstrates all six node shapes with edges and groups. Used for visual regression testing.",
    sourceExport: "@diagram/sim-examples/shapes-example-source",
  },
];
