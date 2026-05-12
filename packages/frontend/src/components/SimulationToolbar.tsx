import React from "react";
import type { SimStatus } from "@diagram/sim-worker";

interface SimulationToolbarProps {
  status: SimStatus;
  simTime: number | null;
  error: string | null;
  speed: number;
  timeWindow: number | null;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onStep: () => void;
  onReset: () => void;
  onSetSpeed: (multiplier: number) => void;
  onSetTimeWindow: (window: number | null) => void;
}

const SPEED_OPTIONS = [
  { label: "0.1x", value: 0.1 },
  { label: "0.5x", value: 0.5 },
  { label: "1x", value: 1 },
  { label: "2x", value: 2 },
  { label: "10x", value: 10 },
  { label: "max", value: Infinity },
];

const TIME_WINDOW_OPTIONS: { label: string; value: number | null }[] = [
  { label: "All", value: null },
  { label: "0.1s", value: 0.1 },
  { label: "1s", value: 1 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
];

const SimulationToolbar: React.FC<SimulationToolbarProps> = ({
  status,
  simTime,
  error,
  speed,
  timeWindow,
  onRun,
  onPause,
  onResume,
  onStep,
  onReset,
  onSetSpeed,
  onSetTimeWindow,
}) => {
  const canRun = status === "idle" || status === "done" || status === "error";
  const canPause = status === "running";
  const canResume = status === "paused";
  const canReset = status !== "idle";

  return (
    <div className="simulation-toolbar">
      <div className="simulation-toolbar-buttons">
        {canRun && (
          <button className="sim-btn sim-btn-primary" onClick={onRun}>
            Run
          </button>
        )}
        {canPause && (
          <button className="sim-btn" onClick={onPause}>
            Pause
          </button>
        )}
        {canResume && (
          <>
            <button className="sim-btn sim-btn-primary" onClick={onResume}>
              Resume
            </button>
            <button className="sim-btn" onClick={onStep}>
              Step
            </button>
          </>
        )}
        {canReset && (
          <button className="sim-btn sim-btn-danger" onClick={onReset}>
            Reset
          </button>
        )}

        <div className="sim-dropdown-group">
          <label className="sim-dropdown-label">
            Speed
            <select
              className="sim-select"
              value={String(speed)}
              onChange={(e) => {
                onSetSpeed(Number(e.target.value));
              }}
            >
              {SPEED_OPTIONS.map((opt) => (
                <option key={opt.label} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sim-dropdown-label">
            Window
            <select
              className="sim-select"
              value={timeWindow === null ? "" : String(timeWindow)}
              onChange={(e) => {
                const v = e.target.value;
                onSetTimeWindow(v === "" ? null : Number(v));
              }}
            >
              {TIME_WINDOW_OPTIONS.map((opt) => (
                <option
                  key={opt.label}
                  value={opt.value === null ? "" : String(opt.value)}
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="simulation-toolbar-status">
        <span className={`sim-status sim-status-${status}`}>{status}</span>
        {simTime !== null && (
          <span className="sim-time">t = {simTime.toFixed(1)}s</span>
        )}
        {error && <span className="sim-error">{error}</span>}
      </div>
    </div>
  );
};

export default SimulationToolbar;
