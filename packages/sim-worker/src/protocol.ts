/**
 * Worker protocol types for the sim worker. Defines the command/message
 * discriminated unions exchanged over postMessage between the main thread
 * (SimWorkerBridge) and the sim worker.
 */

import type { DiagramSpec } from "@diagram/diagram-view";
import type { InputDescriptor, MetricSnapshot } from "@diagram/sim-model";

/** Tagged MetricSnapshot that identifies which registration produced it. */
export interface TaggedMetricSnapshot extends MetricSnapshot {
  nodeName: string;
}

export type SimStatus = "idle" | "running" | "paused" | "done" | "error";

/**
 * Payload sent from the main thread to the worker to initialize a simulation.
 *
 * Named so both the sender (SimWorkerBridge) and the receiver
 * (worker.handleInit) reference the same shape.
 *
 * `inputValues` carries frontend-owned input state so the worker can hydrate
 * the freshly-built engine's input registry. The frontend is the single
 * source of truth for input values across engine rebuilds; the worker
 * applies entries whose id matches a known input and silently drops the
 * rest. Always required — callers pass an empty object when there is
 * nothing to seed.
 */
export interface InitRequest {
  jsSource: string;
  inputValues: Record<string, number | boolean>;
}

/** Commands sent from the main thread to the worker. */
export type SimCommand =
  | ({ type: "init" } & InitRequest)
  | { type: "preview"; jsSource: string }
  | { type: "start" }
  | { type: "pause" }
  | { type: "step" }
  | { type: "setSpeed"; multiplier: number }
  | { type: "setInput"; id: string; value: number | boolean }
  | { type: "requestSnapshot" };

/** Messages sent from the worker to the main thread. */
export type SimMessage =
  | {
      type: "initialized";
      topology: DiagramSpec;
      metricOwnership: Record<string, string[]>;
    }
  | { type: "previewResult"; topology: DiagramSpec }
  | { type: "previewError"; message: string }
  | {
      type: "snapshot";
      simTime: number;
      metrics: TaggedMetricSnapshot[];
      /** Included only when the topology has changed since the last snapshot. */
      topology?: DiagramSpec;
      metricOwnership?: Record<string, string[]>;
    }
  | {
      type: "done";
      simTime: number;
      metrics: TaggedMetricSnapshot[];
      haltReason?: string;
      /** Included only when the topology has changed since the last snapshot. */
      topology?: DiagramSpec;
      metricOwnership?: Record<string, string[]>;
    }
  | { type: "inputsRegistered"; inputs: InputDescriptor[] }
  | { type: "error"; message: string };
