/**
 * Typed async wrapper over the sim worker postMessage protocol.
 * Combines the old WorkerBridge + PreviewBridge into one class.
 */
import type { DiagramSpec } from "@diagram/diagram-view";
import type { InputDescriptor } from "@diagram/sim-model";
import type {
  InitRequest,
  SimCommand,
  SimMessage,
  SimStatus,
  TaggedMetricSnapshot,
} from "./protocol";

interface InitResult {
  topology: DiagramSpec;
  metricOwnership: Record<string, string[]>;
}

export interface SnapshotResult {
  simTime: number;
  metrics: TaggedMetricSnapshot[];
  haltReason?: string;
}

interface PreviewResult {
  topology: DiagramSpec;
}

function createWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
}

export class SimWorkerBridge {
  private worker: Worker;
  private onStatusChange?: (status: SimStatus) => void;
  private onSnapshot?: (snap: SnapshotResult) => void;
  private onTopology?: (spec: DiagramSpec) => void;
  private onMetricOwnership?: (map: Record<string, string[]>) => void;
  private onPreviewResult?: (spec: DiagramSpec) => void;
  private onPreviewError?: (msg: string) => void;
  private onInputsRegistered?: (inputs: InputDescriptor[]) => void;
  private onError?: (msg: string) => void;
  private pendingInit?: {
    resolve: (result: InitResult) => void;
    reject: (err: Error) => void;
  };
  private pendingSnapshot?: {
    resolve: (snap: SnapshotResult) => void;
    reject: (err: Error) => void;
    promise: Promise<SnapshotResult>;
  };
  private pendingPreview?: {
    resolve: (result: PreviewResult) => void;
    reject: (err: Error) => void;
  };

  constructor(callbacks: {
    onStatusChange?: (status: SimStatus) => void;
    onSnapshot?: (snap: SnapshotResult) => void;
    onTopology?: (spec: DiagramSpec) => void;
    onMetricOwnership?: (map: Record<string, string[]>) => void;
    onPreviewResult?: (spec: DiagramSpec) => void;
    onPreviewError?: (msg: string) => void;
    onInputsRegistered?: (inputs: InputDescriptor[]) => void;
    onError?: (msg: string) => void;
  }) {
    this.onStatusChange = callbacks.onStatusChange;
    this.onSnapshot = callbacks.onSnapshot;
    this.onTopology = callbacks.onTopology;
    this.onMetricOwnership = callbacks.onMetricOwnership;
    this.onPreviewResult = callbacks.onPreviewResult;
    this.onPreviewError = callbacks.onPreviewError;
    this.onInputsRegistered = callbacks.onInputsRegistered;
    this.onError = callbacks.onError;

    this.worker = createWorker();
    this.worker.onmessage = (event: MessageEvent<SimMessage>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.onError?.(event.message);
      this.onStatusChange?.("error");
    };
  }

  /**
   * Evaluate JS source, create engine, extract topology.
   *
   * `inputValues` is the frontend's current input-state map. The worker
   * hydrates the freshly-built engine from it before emitting descriptors,
   * so user edits made pre-Start survive engine rebuilds. Pass `{}` when
   * there is nothing to seed.
   */
  async init(
    jsSource: string,
    inputValues: Record<string, number | boolean>,
  ): Promise<InitResult> {
    const request: InitRequest = { jsSource, inputValues };
    return new Promise((resolve, reject) => {
      this.pendingInit = { resolve, reject };
      this.send({ type: "init", ...request });
    });
  }

  /** Evaluate JS source, extract topology only (no engine). */
  async preview(jsSource: string): Promise<PreviewResult> {
    return new Promise((resolve, reject) => {
      this.pendingPreview = { resolve, reject };
      this.send({ type: "preview", jsSource });
    });
  }

  start(): void {
    this.onStatusChange?.("running");
    this.send({ type: "start" });
  }

  pause(): void {
    this.onStatusChange?.("paused");
    this.send({ type: "pause" });
  }

  step(): void {
    this.send({ type: "step" });
  }

  setSpeed(multiplier: number): void {
    this.send({ type: "setSpeed", multiplier });
  }

  /** Send a new value for a registered input to the worker. */
  setInputValue(id: string, value: number | boolean): void {
    this.send({ type: "setInput", id, value });
  }

  requestSnapshot(): Promise<SnapshotResult> {
    if (this.pendingSnapshot) return this.pendingSnapshot.promise;
    let savedResolve: ((snap: SnapshotResult) => void) | undefined;
    let savedReject: ((err: Error) => void) | undefined;
    const promise = new Promise<SnapshotResult>((res, rej) => {
      savedResolve = res;
      savedReject = rej;
    });
    // The Promise executor runs synchronously, so savedResolve/savedReject are set.
    if (!savedResolve || !savedReject)
      throw new Error("Promise executor did not run");
    this.pendingSnapshot = {
      resolve: savedResolve,
      reject: savedReject,
      promise,
    };
    this.send({ type: "requestSnapshot" });
    return promise;
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(cmd: SimCommand): void {
    this.worker.postMessage(cmd);
  }

  private handleMessage(msg: SimMessage): void {
    switch (msg.type) {
      case "initialized":
        this.handleInitialized(msg.topology, msg.metricOwnership);
        break;
      case "previewResult":
        this.handlePreviewResult(msg.topology);
        break;
      case "previewError":
        this.handlePreviewError(msg.message);
        break;
      case "snapshot":
        this.handleSnapshotWithTopology(msg);
        break;
      case "done":
        this.handleDoneWithTopology(msg);
        break;
      case "inputsRegistered":
        this.onInputsRegistered?.(msg.inputs);
        break;
      case "error":
        this.handleError(msg.message);
        break;
    }
  }

  private handleInitialized(
    topology: DiagramSpec,
    metricOwnership: Record<string, string[]>,
  ): void {
    this.onTopology?.(topology);
    this.onMetricOwnership?.(metricOwnership);
    this.onStatusChange?.("paused");
    this.pendingInit?.resolve({ topology, metricOwnership });
    this.pendingInit = undefined;
  }

  private handlePreviewResult(topology: DiagramSpec): void {
    this.onPreviewResult?.(topology);
    this.pendingPreview?.resolve({ topology });
    this.pendingPreview = undefined;
  }

  private handlePreviewError(message: string): void {
    this.onPreviewError?.(message);
    this.pendingPreview?.reject(new Error(message));
    this.pendingPreview = undefined;
  }

  private applyTopologyIfPresent(
    topology?: DiagramSpec,
    metricOwnership?: Record<string, string[]>,
  ): void {
    if (topology) {
      this.onTopology?.(topology);
    }
    if (metricOwnership) {
      this.onMetricOwnership?.(metricOwnership);
    }
  }

  private handleSnapshotWithTopology(msg: {
    simTime: number;
    metrics: TaggedMetricSnapshot[];
    topology?: DiagramSpec;
    metricOwnership?: Record<string, string[]>;
  }): void {
    this.applyTopologyIfPresent(msg.topology, msg.metricOwnership);
    this.onSnapshot?.({ simTime: msg.simTime, metrics: msg.metrics });
    this.pendingSnapshot?.resolve({
      simTime: msg.simTime,
      metrics: msg.metrics,
    });
    this.pendingSnapshot = undefined;
  }

  private handleDoneWithTopology(msg: {
    simTime: number;
    metrics: TaggedMetricSnapshot[];
    haltReason?: string;
    topology?: DiagramSpec;
    metricOwnership?: Record<string, string[]>;
  }): void {
    this.applyTopologyIfPresent(msg.topology, msg.metricOwnership);
    this.onSnapshot?.({
      simTime: msg.simTime,
      metrics: msg.metrics,
      haltReason: msg.haltReason,
    });
    this.onStatusChange?.("done");
  }

  private handleError(message: string): void {
    this.onError?.(message);
    this.onStatusChange?.("error");
    this.pendingInit?.reject(new Error(message));
    this.pendingInit = undefined;
    this.pendingSnapshot?.reject(new Error(message));
    this.pendingSnapshot = undefined;
    this.pendingPreview?.reject(new Error(message));
    this.pendingPreview = undefined;
  }
}
