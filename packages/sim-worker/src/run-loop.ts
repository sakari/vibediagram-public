/**
 * Extracted simulation run loop, decoupled from worker globals for testability.
 *
 * The loop advances the simulation engine at a pace controlled by the speed
 * multiplier while yielding to the event loop at a fixed wall-clock cadence
 * (~60 fps) so that snapshot polling stays responsive regardless of speed.
 */

/** Minimal engine surface needed by the run loop. */
export interface RunLoopEngine {
  currentTime: number;
  step(): Promise<boolean>;
}

/** Mutable state shared between the run loop and external commands. */
export interface RunLoopState {
  running: boolean;
  paused: boolean;
  speedMultiplier: number;
  /** Interpolated sim time for display – advances smoothly between events. */
  displaySimTime: number;
  /** Wall-clock anchor (ms) – reset on speed changes and resume. */
  wallAnchor: number;
  /** Sim-time anchor – reset on speed changes and resume. */
  simAnchor: number;
}

/** Injectable clock & delay so tests can control time. */
export interface RunLoopClock {
  now(): number;
  delay(ms: number): Promise<void>;
}

/** Fixed wall-clock yield cadence (~60 fps). */
const TICK_MS = 16;

/**
 * Run the simulation engine, throttled by the speed multiplier.
 *
 * Events are stepped in time-budget batches and the loop yields every
 * ~TICK_MS so snapshot requests are served promptly at all speeds,
 * including `Infinity` ("max").
 */
export async function runLoop(
  engine: RunLoopEngine,
  state: RunLoopState,
  clock: RunLoopClock,
): Promise<void> {
  state.running = true;
  state.paused = false;

  state.wallAnchor = clock.now();
  state.simAnchor = engine.currentTime;

  // Indirected reads prevent TypeScript CFA from narrowing across async boundaries.
  while (isRunning(state) && !isPaused(state)) {
    const now = clock.now();
    const wallElapsed = (now - state.wallAnchor) / 1000;
    const targetSimTime = state.simAnchor + wallElapsed * state.speedMultiplier;

    // Step events until we reach the target sim time or exhaust the tick budget
    const tickDeadline = now + TICK_MS;
    let done = false;
    while (engine.currentTime <= targetSimTime) {
      const stepped = await engine.step();
      if (!stepped) {
        done = true;
        break;
      }
      // Yield after ~TICK_MS of wall-clock work so snapshots can be served
      if (clock.now() >= tickDeadline) break;
    }

    // Use the target if engine hasn't overshot, else engine time
    state.displaySimTime = done
      ? engine.currentTime
      : Math.min(targetSimTime, engine.currentTime);

    if (done) {
      state.running = false;
      break;
    }

    // Yield to event loop for consistent snapshot polling
    await clock.delay(TICK_MS);
  }
}

/**
 * Re-anchor the time mapping when speed changes mid-run.
 * Call this from the setSpeed command handler.
 */
export function reanchorSpeed(
  state: RunLoopState,
  engineCurrentTime: number,
  newSpeed: number,
  clock: RunLoopClock,
): void {
  if (state.running) {
    state.wallAnchor = clock.now();
    state.simAnchor = engineCurrentTime;
  }
  state.speedMultiplier = newSpeed;
}

/** Indirected to prevent TypeScript CFA narrowing across async boundaries. */
function isRunning(state: RunLoopState): boolean {
  return state.running;
}

/** Indirected to prevent TypeScript CFA narrowing across async boundaries. */
function isPaused(state: RunLoopState): boolean {
  return state.paused;
}
