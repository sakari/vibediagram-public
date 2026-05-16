import { useCallback, useEffect, useState } from "react";

/**
 * The drawing-mode state surfaced by {@link DrawingToolbar} to its parent.
 *
 * The toolbar owns this state and pushes a fresh value on every change via
 * {@link DrawingToolbarProps.onStateChange}. The parent feeds the relevant
 * fields straight into `DrawOverlay`.
 *
 * `tool === "hand"` is the visual-regression-safe default: the overlay
 * stays mounted with `pointer-events: none`, so existing strokes remain
 * visible but pan/zoom and clicks fall through to the underlying view.
 */
export interface DrawingState {
  tool: "hand" | "pen" | "eraser";
  color: string;
  width: number;
}

interface DrawingToolbarProps {
  /**
   * When `true`, the "Clear all" button is rendered. Mirrors the read-only
   * banner gating in `DiagramWorkspace.tsx` so a lurker cannot wipe a
   * writer's marks mid-conversation. (See "Who can clear" in the plan.)
   */
  canWrite: boolean;
  /** Invoked when the user clicks "Clear all". */
  onClear: () => void;
  /**
   * Called on every state transition so the parent can pass the live state
   * down to `DrawOverlay`. The toolbar emits an initial value on mount so
   * the parent's first render sees the same defaults the toolbar shows.
   */
  onStateChange: (state: DrawingState) => void;
}

/**
 * Three pen colors the user can pick between. Kept tiny on purpose: per
 * the plan, drawing is a transient pointing aid, not a styling surface.
 */
const COLORS: readonly string[] = ["#ff5252", "#ffd740", "#69f0ae"];
/** Three line widths, in CSS pixels at zoom-1. Indices map to dot sizes. */
const WIDTHS: readonly number[] = [2, 4, 8];

const DEFAULT_STATE: DrawingState = {
  tool: "hand",
  color: COLORS[0],
  width: WIDTHS[1],
};

/**
 * Tiny stateful toolbar that holds the drawing tool/color/width and
 * mirrors them to the parent on every change.
 *
 * The toolbar is always-on: existing strokes are visible regardless of
 * tool. The "hand" tool means "don't capture pointer events" — pan/zoom
 * the diagram or scroll the markdown normally. Pen draws; eraser deletes
 * individual strokes by click.
 */
export function DrawingToolbar({
  canWrite,
  onClear,
  onStateChange,
}: DrawingToolbarProps) {
  const [state, setState] = useState(DEFAULT_STATE);

  // Push initial + every subsequent change to the parent. Using an effect
  // (rather than calling `onStateChange` from the click handlers directly)
  // ensures the parent sees the same defaults on mount that the toolbar
  // is rendering, without callers needing to mirror the constant.
  useEffect(() => {
    onStateChange(state);
  }, [state, onStateChange]);

  const setTool = useCallback((tool: DrawingState["tool"]) => {
    setState((prev) => ({ ...prev, tool }));
  }, []);

  const setColor = useCallback((color: string) => {
    setState((prev) => ({ ...prev, color }));
  }, []);

  const setWidth = useCallback((width: number) => {
    setState((prev) => ({ ...prev, width }));
  }, []);

  const showPenControls = state.tool === "pen";

  return (
    <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="drawing-toolbar-group" role="group" aria-label="Tool">
        <button
          type="button"
          className={
            state.tool === "hand"
              ? "drawing-toolbar-tool drawing-toolbar-tool-active"
              : "drawing-toolbar-tool"
          }
          aria-label="Hand (pan and zoom)"
          aria-pressed={state.tool === "hand"}
          title="Switch to hand tool: pan and zoom without drawing"
          onClick={() => {
            setTool("hand");
          }}
        >
          Hand
        </button>
        <button
          type="button"
          className={
            state.tool === "pen"
              ? "drawing-toolbar-tool drawing-toolbar-tool-active"
              : "drawing-toolbar-tool"
          }
          aria-label="Pen"
          aria-pressed={state.tool === "pen"}
          title="Switch to pen tool: draw strokes on the diagram"
          onClick={() => {
            setTool("pen");
          }}
        >
          Pen
        </button>
        <button
          type="button"
          className={
            state.tool === "eraser"
              ? "drawing-toolbar-tool drawing-toolbar-tool-active"
              : "drawing-toolbar-tool"
          }
          aria-label="Eraser"
          aria-pressed={state.tool === "eraser"}
          title="Switch to eraser tool: click strokes to delete them"
          onClick={() => {
            setTool("eraser");
          }}
        >
          Eraser
        </button>
      </div>
      {showPenControls && (
        <>
          <div
            className="drawing-toolbar-group"
            role="group"
            aria-label="Color"
          >
            {COLORS.map((color) => {
              const active = state.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  className={
                    active
                      ? "drawing-toolbar-swatch drawing-toolbar-swatch-active"
                      : "drawing-toolbar-swatch"
                  }
                  aria-label={`Color ${color}`}
                  aria-pressed={active}
                  title={`Use ${color} as the pen color`}
                  style={{ background: color }}
                  onClick={() => {
                    setColor(color);
                  }}
                />
              );
            })}
          </div>
          <div
            className="drawing-toolbar-group"
            role="group"
            aria-label="Width"
          >
            {WIDTHS.map((width) => {
              const active = state.width === width;
              return (
                <button
                  key={width}
                  type="button"
                  className={
                    active
                      ? "drawing-toolbar-width drawing-toolbar-width-active"
                      : "drawing-toolbar-width"
                  }
                  aria-label={`Width ${String(width)}`}
                  aria-pressed={active}
                  title={`Use ${String(width)}px as the pen width`}
                  onClick={() => {
                    setWidth(width);
                  }}
                >
                  <span
                    className="drawing-toolbar-width-dot"
                    style={{
                      width: `${String(width * 2)}px`,
                      height: `${String(width * 2)}px`,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </>
      )}
      {canWrite && (
        <button
          type="button"
          className="drawing-toolbar-clear sim-btn sim-btn-danger"
          aria-label="Clear all drawings"
          title="Delete all drawings from this diagram"
          onClick={onClear}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
