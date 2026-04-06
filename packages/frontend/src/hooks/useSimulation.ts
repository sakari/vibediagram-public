import { useState, useCallback, useRef, useEffect } from "react";
import type { DiagramSpec } from "@diagram/diagram-view";
import type { InputDescriptor } from "@diagram/sim-model";
import { SimWorkerBridge, type SnapshotResult } from "@diagram/sim-worker";
import type { SimStatus, TaggedMetricSnapshot } from "@diagram/sim-worker";
import { useInputs } from "./useInputs";

interface UseSimulationResult {
  status: SimStatus;
  topology: DiagramSpec | null;
  metricOwnership: Record<string, string[]> | null;
  /** Metrics grouped by owning Blueprint name. */
  metricsByNode: Map<string, TaggedMetricSnapshot[]>;
  /** Descriptors for all registered inputs, populated after init. */
  inputDescriptors: InputDescriptor[];
  /** Frontend-owned current input values, keyed by input id. */
  inputValues: Record<string, number | boolean>;
  previewError: string | null;
  snapshot: SnapshotResult | null;
  error: string | null;
  preview: (jsSource: string) => void;
  init: (jsSource: string) => Promise<void>;
  start: () => void;
  pause: () => void;
  step: () => void;
  setSpeed: (multiplier: number) => void;
  /** Send a new value for a registered input to the worker. */
  setInputValue: (id: string, value: number | boolean) => void;
  reset: () => void;
}

/**
 * React hook managing the simulation lifecycle via SimWorkerBridge.
 *
 * `preview` evaluates user code and returns a DiagramSpec for live
 * topology rendering without creating an engine.
 *
 * `init` + `start` runs the full simulation. Snapshots are polled at
 * requestAnimationFrame cadence while running.
 */
export function useSimulation(): UseSimulationResult {
  const [status, setStatus] = useState<SimStatus>("idle");
  const [topology, setTopology] = useState<DiagramSpec | null>(null);
  const [metricOwnership, setMetricOwnership] = useState<Record<
    string,
    string[]
  > | null>(null);
  const [metricsByNode, setMetricsByNode] = useState(
    new Map<string, TaggedMetricSnapshot[]>(),
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bridgeRef = useRef<SimWorkerBridge | null>(null);
  const {
    inputDescriptors,
    inputValues,
    setInputValue,
    onInputsRegistered,
    resetInputs,
  } = useInputs(bridgeRef);
  // Keep a ref so `init` can read the latest map without rebinding on every
  // value change (which would defeat memoization of handlers that depend on
  // `init`).
  const inputValuesRef = useRef(inputValues);
  useEffect(() => {
    inputValuesRef.current = inputValues;
  }, [inputValues]);
  const previewBridgeRef = useRef<SimWorkerBridge | null>(null);
  const previewSeqRef = useRef(0);
  const rafRef = useRef(0);
  const statusRef = useRef<SimStatus>("idle");
  const metricOwnershipRef = useRef<Record<string, string[]> | null>(null);

  useEffect(() => {
    statusRef.current = status;
  });

  const stopPolling = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  /**
   * Index TaggedMetricSnapshot[] by metric node name so each metric
   * child node in the diagram receives its own snapshot data.
   */
  const groupMetrics = useCallback(
    (metrics: TaggedMetricSnapshot[]): Map<string, TaggedMetricSnapshot[]> => {
      const byNode = new Map<string, TaggedMetricSnapshot[]>();
      for (const m of metrics) {
        let arr = byNode.get(m.nodeName);
        if (!arr) {
          arr = [];
          byNode.set(m.nodeName, arr);
        }
        arr.push(m);
      }
      return byNode;
    },
    [],
  );

  const snapshotInFlight = useRef(false);

  const startPolling = useCallback(() => {
    const poll = () => {
      if (statusRef.current !== "running" || !bridgeRef.current) return;
      if (!snapshotInFlight.current) {
        snapshotInFlight.current = true;
        bridgeRef.current.requestSnapshot().then(
          (snap) => {
            snapshotInFlight.current = false;
            setSnapshot(snap);
            if (metricOwnershipRef.current) {
              setMetricsByNode(groupMetrics(snap.metrics));
            }
          },
          () => {
            snapshotInFlight.current = false;
          },
        );
      }
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
  }, [groupMetrics]);

  const handleStatusChange = useCallback(
    (newStatus: SimStatus) => {
      // Update ref synchronously so polling and preview guards see the
      // correct status immediately (the useEffect ref sync is deferred).
      statusRef.current = newStatus;
      setStatus(newStatus);
      if (newStatus !== "running") {
        stopPolling();
      }
    },
    [stopPolling],
  );

  const createBridge = useCallback(() => {
    bridgeRef.current?.terminate();
    stopPolling();
    // Clear in-flight flag — the terminated bridge will never resolve its
    // pending snapshot promise, so the flag would leak as true forever.
    snapshotInFlight.current = false;

    const bridge = new SimWorkerBridge({
      onStatusChange: handleStatusChange,
      onSnapshot: (snap) => {
        setSnapshot(snap);
        if (metricOwnershipRef.current) {
          setMetricsByNode(groupMetrics(snap.metrics));
        }
      },
      onTopology: setTopology,
      onMetricOwnership: (map) => {
        metricOwnershipRef.current = map;
        setMetricOwnership(map);
      },
      onInputsRegistered,
      onError: (msg) => {
        setError(msg);
      },
    });
    bridgeRef.current = bridge;
    return bridge;
  }, [handleStatusChange, stopPolling, groupMetrics, onInputsRegistered]);

  const preview = useCallback((jsSource: string) => {
    if (statusRef.current === "running" || statusRef.current === "paused")
      return;

    if (!previewBridgeRef.current) {
      previewBridgeRef.current = new SimWorkerBridge({
        onPreviewResult: setTopology,
        onPreviewError: setPreviewError,
      });
    }

    const seq = ++previewSeqRef.current;
    previewBridgeRef.current.preview(jsSource).then(
      (result) => {
        if (seq !== previewSeqRef.current) return;
        setTopology(result.topology);
        setPreviewError(null);
      },
      (err: unknown) => {
        if (seq !== previewSeqRef.current) return;
        setPreviewError(err instanceof Error ? err.message : String(err));
      },
    );
  }, []);

  const init = useCallback(
    async (jsSource: string) => {
      setError(null);
      setPreviewError(null);
      setSnapshot(null);
      setMetricsByNode(new Map());
      const bridge = createBridge();
      try {
        const result = await bridge.init(jsSource, inputValuesRef.current);
        setTopology(result.topology);
        metricOwnershipRef.current = result.metricOwnership;
        setMetricOwnership(result.metricOwnership);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [createBridge],
  );

  const start = useCallback(() => {
    if (!bridgeRef.current) return;
    // Update ref synchronously so the rAF polling loop (which reads
    // statusRef.current) sees "running" even before React flushes the
    // state update and effect that normally syncs the ref.
    statusRef.current = "running";
    setStatus("running");
    bridgeRef.current.start();
    startPolling();
  }, [startPolling]);

  const pause = useCallback(() => {
    bridgeRef.current?.pause();
  }, []);

  const step = useCallback(() => {
    bridgeRef.current?.step();
  }, []);

  const setSpeed = useCallback((multiplier: number) => {
    bridgeRef.current?.setSpeed(multiplier);
  }, []);

  const reset = useCallback(() => {
    bridgeRef.current?.terminate();
    bridgeRef.current = null;
    stopPolling();
    setStatus("idle");
    // Update ref synchronously so that callers invoking preview() immediately
    // after reset() see the correct status (the useEffect ref sync is deferred).
    statusRef.current = "idle";
    // Clear in-flight flag — the terminated bridge will never resolve its
    // pending snapshot promise, so the flag would leak as true forever.
    snapshotInFlight.current = false;
    setTopology(null);
    setMetricOwnership(null);
    setMetricsByNode(new Map());
    setSnapshot(null);
    setError(null);
    setPreviewError(null);
    resetInputs();
    metricOwnershipRef.current = null;
  }, [stopPolling, resetInputs]);

  useEffect(() => {
    return () => {
      bridgeRef.current?.terminate();
      previewBridgeRef.current?.terminate();
      stopPolling();
    };
  }, [stopPolling]);

  return {
    status,
    topology,
    metricOwnership,
    metricsByNode,
    inputDescriptors,
    inputValues,
    previewError,
    snapshot,
    error,
    preview,
    init,
    start,
    pause,
    step,
    setSpeed,
    setInputValue,
    reset,
  };
}
