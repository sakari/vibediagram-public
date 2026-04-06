/**
 * Worker pool draining a queue. Demonstrates dynamic node spawning driven
 * by actual load: a Supervisor watches queue depth and spawns additional
 * Worker nodes when the queue backs up. Raise the arrival rate with the
 * slider and watch workers appear as the queue grows.
 */

import {
  Blueprint,
  InputNode,
  component,
  createModel,
  distributions,
  metrics,
  Distribution,
  type StyleRuleDescriptor,
} from "@diagram/sim-model";

interface Task {
  id: number;
}

/**
 * FIFO queue with async pop() semantics: workers that call pop() on an
 * empty queue park until the next push(). Tasks arriving while waiters
 * exist skip the buffer and go directly to a waiter.
 */
class Queue extends Blueprint {
  params = {
    depth: component.ref(metrics.Gauge, (m, name) =>
      m.create(name, metrics.Gauge, () => ({
        unit: "count" as const,
        description: "Current number of buffered tasks in the queue",
      })),
    ),
    capacity: component.ref(InputNode, (m, name) =>
      m.create(name, InputNode, () => ({
        kind: "number",
        defaultValue: 100,
        min: 1,
        max: 1000,
        step: 1,
        label: "Queue Capacity",
        description: "Maximum buffered tasks before new arrivals are dropped",
      })),
    ),
    dropped: component.ref(metrics.Counter, (m, name) =>
      m.create(name, metrics.Counter, () => ({
        description: "Tasks dropped because the queue was at capacity",
      })),
    ),
  };

  private items: Task[] = [];
  private waiters: Array<(task: Task) => void> = [];

  engineOnStart() {}

  push(task: Task): void {
    // Hand-off directly to a parked worker if one is waiting.
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(task);
      return;
    }
    if (this.items.length >= this.params.capacity.value) {
      this.params.dropped.increment({});
      return;
    }
    this.items.push(task);
    this.params.depth.set({}, this.items.length);
  }

  pop(): Promise<Task> {
    const item = this.items.shift();
    if (item !== undefined) {
      this.params.depth.set({}, this.items.length);
      return Promise.resolve(item);
    }
    return new Promise<Task>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/**
 * Produces tasks at a user-adjustable rate using Poisson arrivals. Draws
 * from a unit-mean Exponential distribution and scales samples by 1/rate —
 * matching the convention used by HttpTrafficGeneratorBlueprint.
 */
class Producer extends Blueprint {
  params = {
    queue: component.ref(Queue),
    rate: component.ref(InputNode),
    arrivalDistribution: component.ref(Distribution, (m, name) =>
      m.create(name, distributions.Exponential, () => ({
        description: "Unit-mean exponential used to sample inter-arrival times",
      })),
    ),
    produced: component.ref(metrics.Counter, (m, name) =>
      m.create(name, metrics.Counter, () => ({
        description: "Total tasks emitted by the producer",
      })),
    ),
  };

  private nextId = 0;

  engineOnStart() {
    void this.loop();
  }

  async loop() {
    for (;;) {
      const rate = Math.max(0.01, this.params.rate.value);
      const sample = Math.max(0, this.params.arrivalDistribution.draw());
      const interArrival = sample / rate;
      await this.engine.timeout(interArrival);
      this.nextId++;
      this.params.queue.push({ id: this.nextId });
      this.params.produced.increment({});
    }
  }
}

/**
 * Dynamically spawned worker. Pulls tasks from the queue, processes each
 * for a configurable service time, and exposes a `status` gauge
 * (1 = busy, 0 = idle) that style rules key off of.
 */
class Worker extends Blueprint {
  params = {
    queue: component.ref(Queue),
    serviceTime: component.ref(InputNode),
    processed: component.ref(metrics.Counter, (m, name) =>
      m.create(name, metrics.Counter, () => ({
        description: "Tasks this worker has finished processing",
      })),
    ),
    status: component.ref(metrics.Gauge, (m, name) =>
      m.create(name, metrics.Gauge, () => ({
        description: "Worker busy state: 1 while processing, 0 when idle",
      })),
    ),
  };

  engineOnStart() {
    this.params.status.set({}, 0);
    void this.loop();
  }

  async loop() {
    for (;;) {
      await this.params.queue.pop();
      this.params.status.set({}, 1);
      await this.engine.timeout(this.params.serviceTime.value);
      this.params.processed.increment({});
      this.params.status.set({}, 0);
    }
  }
}

/**
 * Watches queue depth and spawns a new Worker whenever the backlog
 * exceeds `spawnThreshold`, up to `maxWorkers`. Spawns a single worker at
 * startup so the system can begin processing immediately.
 *
 * Note: the framework has no despawn API, so workers persist once created.
 * When load drops, extra workers simply sit idle (status=0) and are faded
 * visually by a style rule. This mirrors how most real pools behave on
 * short timescales — scale-down is slow, scale-up is fast.
 */
class Supervisor extends Blueprint {
  params = {
    queue: component.ref(Queue),
    serviceTime: component.ref(InputNode),
    spawnThreshold: component.ref(InputNode),
    maxWorkers: component.ref(InputNode),
    workerCount: component.ref(metrics.Gauge, (m, name) =>
      m.create(name, metrics.Gauge, () => ({
        description: "Number of workers currently spawned by the supervisor",
      })),
    ),
  };

  private workers = 0;

  engineOnStart() {
    this.spawnWorker();
    void this.monitor();
  }

  private spawnWorker(): void {
    this.workers++;
    const idx = this.workers;
    this.engine.spawn(`worker-${String(idx)}`, Worker, () => ({
      queue: this.params.queue,
      serviceTime: this.params.serviceTime,
      description: "Pulls tasks from the queue and processes them serially",
    }));
    this.params.workerCount.set({}, this.workers);
  }

  async monitor() {
    for (;;) {
      await this.engine.timeout(0.5);
      // Read the queue's depth gauge — the canonical backlog value.
      // The gauge starts empty (no labels set) until the first push(),
      // so guard on length.
      const snaps = this.params.queue.params.depth.metrics();
      const backlog = snaps.length > 0 ? snaps[0].value.value : 0;
      if (
        backlog >= this.params.spawnThreshold.value &&
        this.workers < this.params.maxWorkers.value
      ) {
        this.spawnWorker();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Model registration
// ---------------------------------------------------------------------------

// Wrapped in a function so each caller gets a fresh model with fresh
// Blueprint instances. Necessary for tests that run multiple engines
// against the same model source — Supervisor carries per-instance state
// (`workers`) that would otherwise leak across runs.
export function buildModel() {
  const model = createModel();

  // Starts at 1 task/s so one worker can easily keep up — drag this up
  // to see the queue back up and the supervisor spawn more workers.
  const arrivalRate = model.create("arrivalRate", InputNode, () => ({
    kind: "number",
    defaultValue: 1,
    min: 1,
    max: 500,
    step: 1,
    label: "Arrival Rate (tasks/s)",
    description:
      "Mean rate of Poisson task arrivals. Raise this to back the queue up.",
  }));

  const serviceTime = model.create("serviceTime", InputNode, () => ({
    kind: "number",
    defaultValue: 0.2,
    min: 0.01,
    max: 2,
    step: 0.01,
    label: "Service Time (s)",
    description: "How long each worker takes to process a single task",
  }));

  const spawnThreshold = model.create("spawnThreshold", InputNode, () => ({
    kind: "number",
    defaultValue: 5,
    min: 1,
    max: 100,
    step: 1,
    label: "Depth to Spawn Worker",
    description:
      "Queue depth that triggers the supervisor to spawn another worker",
  }));

  // Starts at 1 — the supervisor never spawns beyond this until the user
  // raises the cap. Pair with the low arrival rate above: on first run
  // you see a single worker comfortably draining a trickle of tasks, then
  // you crank up Arrival Rate, watch the queue grow, then raise Max
  // Workers and watch new workers spawn to catch up.
  const maxWorkers = model.create("maxWorkers", InputNode, () => ({
    kind: "number",
    defaultValue: 1,
    min: 1,
    max: 20,
    step: 1,
    label: "Max Workers",
    description: "Hard cap on how many workers the supervisor may spawn",
  }));

  const queue = model.create("queue", Queue, () => ({
    description: "FIFO work queue drained by a dynamic pool of workers",
  }));

  model.create("producer", Producer, () => ({
    queue,
    rate: arrivalRate,
    description: "Emits tasks using Poisson arrivals at the configured rate",
  }));

  model.create("supervisor", Supervisor, () => ({
    queue,
    serviceTime,
    spawnThreshold,
    maxWorkers,
    description:
      "Spawns a new worker whenever the queue depth exceeds the threshold",
  }));

  model.addStyleRules(styles);
  return model;
}

// ---------------------------------------------------------------------------
// Style rules
// ---------------------------------------------------------------------------

const styles: StyleRuleDescriptor[] = [
  // Producer — traffic source
  {
    name: "producer-style",
    match: { id: "producer" },
    style: {
      borderColor: "#9b59b6",
      background: "#3a1a50",
      borderWidth: 2,
      boxShadow: "0 0 6px rgba(155, 89, 182, 0.3)",
      shape: "circle",
    },
  },

  // Supervisor — control plane
  {
    name: "supervisor-style",
    match: { id: "supervisor" },
    style: {
      borderColor: "#3498db",
      background: "#1a3050",
      borderWidth: 2,
      shape: "diamond",
    },
  },

  // Queue — color-shift from calm blue to alarm red as backlog grows.
  // The gauge is auto-created as "queue/depth" via the param default factory.
  {
    name: "queue-heat",
    priority: 10,
    match: { id: "queue" },
    style: (node) => {
      const depth = node.metric("queue/depth") ?? 0;
      // Normalize against the spawn threshold: above 4x threshold looks fully red.
      const heat = Math.min(1, depth / 20);
      const r = Math.round(40 + 200 * heat);
      const g = Math.round(60 + 40 * (1 - heat));
      const b = Math.round(120 * (1 - heat));
      return {
        background: `rgb(${String(r)}, ${String(g)}, ${String(b)})`,
        borderColor: heat > 0.6 ? "#ff4444" : "#3498db",
        borderWidth: 2,
      };
    },
  },

  // Workers — busy ones glow, idle ones fade.
  // Each worker's status gauge is auto-created as "<worker-id>/status".
  {
    name: "worker-style",
    priority: 10,
    match: (node) => /^worker-\d+$/.test(node.id),
    style: (node) => {
      const status = node.metric(`${node.id}/status`) ?? 0;
      const busy = status > 0.5;
      return {
        shape: "hexagon",
        borderWidth: 2,
        background: busy ? "#1a4a2a" : "#1c2530",
        borderColor: busy ? "#2ecc71" : "#566070",
        opacity: busy ? 1 : 0.55,
        boxShadow: busy ? "0 0 8px rgba(46, 204, 113, 0.4)" : undefined,
      };
    },
  },
];

export const model = buildModel();
