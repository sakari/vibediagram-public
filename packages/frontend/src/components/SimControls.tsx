import React from "react";
import type { SimStatus } from "@diagram/sim-worker";

interface SimControlsProps {
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
  /** Optional leading element rendered before the sim buttons (e.g. editor toggle). */
  leading?: React.ReactNode;
  /** Fork the current project into a new copy. */
  onFork?: () => void;
  /** Whether the fork button should be disabled (e.g. while forking is in progress). */
  forkDisabled?: boolean;
  /** Whether the project is publicly readable. */
  isPublic?: boolean;
  /** Toggle public/private access on the project. */
  onTogglePublic?: (makePublic: boolean) => void;
  /** Whether the current user can change public access (admin only). */
  canManageAccess?: boolean;
  /** Current project title (shown in the toolbar). */
  projectTitle?: string;
  /** Called when the user edits the project title. */
  onTitleChange?: (title: string) => void;
  /** Whether the project is read-only for the current user. */
  readOnly?: boolean;
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

function SimButtons({
  status,
  onRun,
  onPause,
  onResume,
  onStep,
  onReset,
}: Pick<
  SimControlsProps,
  "status" | "onRun" | "onPause" | "onResume" | "onStep" | "onReset"
>) {
  const canRun = status === "idle" || status === "done" || status === "error";
  const canPause = status === "running";
  const canResume = status === "paused";
  const canReset = status !== "idle";

  return (
    <>
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
    </>
  );
}

const SimControls: React.FC<SimControlsProps> = ({
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
  leading,
  onFork,
  forkDisabled,
  projectTitle,
  onTitleChange,
  isPublic,
  onTogglePublic,
  canManageAccess,
  readOnly,
}) => {
  return (
    <div className="sim-controls">
      <div className="sim-controls-buttons">
        {leading}
        {projectTitle !== undefined && (
          <input
            className="sim-title-input"
            value={projectTitle}
            onChange={(e) => onTitleChange?.(e.target.value)}
            aria-label="Project title"
            spellCheck={false}
            readOnly={readOnly || !onTitleChange}
          />
        )}
        <SimButtons
          status={status}
          onRun={onRun}
          onPause={onPause}
          onResume={onResume}
          onStep={onStep}
          onReset={onReset}
        />

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

        {onFork && (
          <button className="sim-btn" onClick={onFork} disabled={forkDisabled}>
            {forkDisabled ? "Forking..." : "Fork"}
          </button>
        )}

        {canManageAccess && onTogglePublic && (
          <button
            className={`sim-btn ${isPublic ? "sim-btn-public" : ""}`}
            onClick={() => {
              onTogglePublic(!isPublic);
            }}
            title={
              isPublic
                ? "This project is publicly readable. Click to make private."
                : "This project is private. Click to make publicly readable."
            }
          >
            {isPublic ? "Public" : "Private"}
          </button>
        )}
      </div>

      <div className="sim-controls-status">
        <span className={`sim-status sim-status-${status}`}>{status}</span>
        {simTime !== null && (
          <span className="sim-time">t = {simTime.toFixed(1)}s</span>
        )}
        {error && <span className="sim-error">{error}</span>}
      </div>
    </div>
  );
};

export default SimControls;
