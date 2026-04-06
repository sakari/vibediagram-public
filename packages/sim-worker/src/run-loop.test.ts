import { describe, it, expect, vi } from "vitest";
import {
  runLoop,
  reanchorSpeed,
  type RunLoopEngine,
  type RunLoopState,
  type RunLoopClock,
} from "./run-loop";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an engine with events at the given sim-times. */
function fakeEngine(eventTimes: number[]): RunLoopEngine {
  let idx = 0;
  let time = 0;
  return {
    get currentTime() {
      return time;
    },
    step() {
      if (idx >= eventTimes.length) return Promise.resolve(false);
      time = eventTimes[idx++];
      return Promise.resolve(true);
    },
  };
}

function createState(overrides?: Partial<RunLoopState>): RunLoopState {
  return {
    running: false,
    paused: false,
    speedMultiplier: 1,
    displaySimTime: 0,
    wallAnchor: 0,
    simAnchor: 0,
    ...overrides,
  };
}

/**
 * Create a fake clock where `now()` returns a controllable value
 * and `delay()` advances it by the requested ms.
 */
function fakeClock(startMs = 0): RunLoopClock & { time: number } {
  const clock = {
    time: startMs,
    now() {
      return clock.time;
    },
    delay(ms: number) {
      clock.time += ms;
      return Promise.resolve();
    },
  };
  return clock;
}

// ---------------------------------------------------------------------------
// Infinity speed
// ---------------------------------------------------------------------------

describe("runLoop at Infinity speed", () => {
  it("runs entire simulation to completion", async () => {
    const engine = fakeEngine([1, 2, 3, 10]);
    const state = createState({ speedMultiplier: Infinity });
    const clock = fakeClock();

    await runLoop(engine, state, clock);

    expect(engine.currentTime).toBe(10);
    expect(state.displaySimTime).toBe(10);
    expect(state.running).toBe(false);
  });

  it("yields periodically so metrics can be polled", async () => {
    const engine = fakeEngine([1, 2, 3, 10]);
    const state = createState({ speedMultiplier: Infinity });
    const clock = fakeClock();
    const delaySpy = vi.spyOn(clock, "delay");

    await runLoop(engine, state, clock);

    // Should have yielded at least once during the run
    expect(delaySpy).toHaveBeenCalled();
    for (const call of delaySpy.mock.calls) {
      expect(call[0]).toBe(16);
    }
  });

  it("updates displaySimTime during run, not just at end", async () => {
    // Many events so the tick deadline forces a yield mid-run
    const events = Array.from({ length: 100 }, (_, i) => i + 1);
    const engine = fakeEngine(events);
    const state = createState({ speedMultiplier: Infinity });
    // Clock advances on each now() call to simulate real time passing during steps
    let wallTime = 0;
    const clock: RunLoopClock = {
      now() {
        // Advance 1ms per call to simulate work
        wallTime += 1;
        return wallTime;
      },
      delay(ms: number) {
        wallTime += ms;
        return Promise.resolve();
      },
    };

    const snapshots: number[] = [];
    const origDelay = clock.delay.bind(clock);
    clock.delay = (ms: number) => {
      snapshots.push(state.displaySimTime);
      return origDelay(ms);
    };

    await runLoop(engine, state, clock);

    // Should have captured intermediate displaySimTime values
    expect(snapshots.length).toBeGreaterThan(0);
    // Each snapshot should show progress
    for (const t of snapshots) {
      expect(t).toBeGreaterThan(0);
    }
    expect(state.displaySimTime).toBe(100);
  });

  it("handles empty event queue at Infinity speed", async () => {
    const engine = fakeEngine([]);
    const state = createState({ speedMultiplier: Infinity });
    const clock = fakeClock();

    await runLoop(engine, state, clock);

    expect(engine.currentTime).toBe(0);
    expect(state.displaySimTime).toBe(0);
    expect(state.running).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Time-budget loop (finite speed)
// ---------------------------------------------------------------------------

describe("runLoop at finite speed", () => {
  it("steps events up to the time budget at 1x speed", async () => {
    // Events at 0.005, 0.010, 0.015, 0.020 (sim seconds)
    // At 1x speed with 16ms ticks, after first tick (16ms wall = 0.016s sim budget)
    // we should step events up to 0.016s → events at 0.005, 0.010, 0.015
    const engine = fakeEngine([0.005, 0.01, 0.015, 0.02, 0.025, 0.03]);
    const state = createState({ speedMultiplier: 1 });
    const clock = fakeClock(1000);

    await runLoop(engine, state, clock);

    // All events processed, simulation completes
    expect(engine.currentTime).toBe(0.03);
    expect(state.running).toBe(false);
  });

  it("yields at ~16ms cadence (calls delay)", async () => {
    const engine = fakeEngine([0.01, 0.02, 0.05, 0.1]);
    const state = createState({ speedMultiplier: 1 });
    const clock = fakeClock(0);
    const delaySpy = vi.spyOn(clock, "delay");

    await runLoop(engine, state, clock);

    // delay should have been called at least once (yielding between ticks)
    expect(delaySpy).toHaveBeenCalled();
    // Each call should be with 16ms
    for (const call of delaySpy.mock.calls) {
      expect(call[0]).toBe(16);
    }
  });

  it("displaySimTime advances smoothly between events", async () => {
    // One event at sim time 1.0. At 1x speed, reaching it takes 1s wall time.
    // Each tick is 16ms, so it takes ~63 ticks to reach sim time 1.0.
    // Between ticks, displaySimTime should interpolate smoothly.
    const displayTimes: number[] = [];
    const engine = fakeEngine([1.0]);
    const state = createState({ speedMultiplier: 1 });
    const clock = fakeClock(0);

    const origDelay = clock.delay.bind(clock);
    clock.delay = async (ms: number) => {
      displayTimes.push(state.displaySimTime);
      await origDelay(ms);
    };

    await runLoop(engine, state, clock);

    // displaySimTime should have been increasing over the ticks
    expect(displayTimes.length).toBeGreaterThan(1);
    for (let i = 1; i < displayTimes.length; i++) {
      expect(displayTimes[i]).toBeGreaterThanOrEqual(displayTimes[i - 1]);
    }
    // Final displaySimTime should be the engine's final time
    expect(state.displaySimTime).toBe(1.0);
  });

  it("at 0.1x speed yields at same cadence as 1x", async () => {
    // At 0.1x, 16ms wall = 1.6ms sim budget per tick
    const engine = fakeEngine([0.01, 0.02]);
    const state = createState({ speedMultiplier: 0.1 });
    const clock = fakeClock(0);
    const delaySpy = vi.spyOn(clock, "delay");

    await runLoop(engine, state, clock);

    // Still yields with 16ms
    expect(delaySpy).toHaveBeenCalled();
    for (const call of delaySpy.mock.calls) {
      expect(call[0]).toBe(16);
    }
  });

  it("at 10x speed processes more events per tick", async () => {
    // At 10x speed, 16ms wall = 160ms sim budget per tick
    // Events at 0.01, 0.02, ..., 0.15 should all be processed in first tick
    const events = Array.from({ length: 15 }, (_, i) => (i + 1) * 0.01);
    const engine = fakeEngine(events);
    const state = createState({ speedMultiplier: 10 });
    const clock = fakeClock(0);
    const delaySpy = vi.spyOn(clock, "delay");

    await runLoop(engine, state, clock);

    // At 10x, first tick budget = 0.16s sim time, all 15 events (up to 0.15) fit
    // So fewer yields needed than at 1x
    expect(delaySpy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("stops when simulation has no more events", async () => {
    const engine = fakeEngine([0.001]);
    const state = createState({ speedMultiplier: 1 });
    const clock = fakeClock(0);

    await runLoop(engine, state, clock);

    expect(state.running).toBe(false);
    expect(engine.currentTime).toBe(0.001);
  });

  it("stops when paused externally", async () => {
    const engine = fakeEngine([0.01, 0.02, 100, 200]);
    const state = createState({ speedMultiplier: 1 });
    const clock = fakeClock(0);

    // Pause after the first delay
    const origDelay = clock.delay.bind(clock);
    let delayCount = 0;
    clock.delay = async (ms: number) => {
      delayCount++;
      if (delayCount >= 2) {
        state.paused = true;
      }
      await origDelay(ms);
    };

    await runLoop(engine, state, clock);

    // Should not have processed all events
    expect(engine.currentTime).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// reanchorSpeed
// ---------------------------------------------------------------------------

describe("reanchorSpeed", () => {
  it("resets anchors when running", () => {
    const clock = fakeClock(5000);
    const state = createState({
      running: true,
      wallAnchor: 1000,
      simAnchor: 2.0,
      speedMultiplier: 1,
    });

    reanchorSpeed(state, 4.5, 2, clock);

    expect(state.wallAnchor).toBe(5000);
    expect(state.simAnchor).toBe(4.5);
    expect(state.speedMultiplier).toBe(2);
  });

  it("does not reset anchors when not running", () => {
    const clock = fakeClock(5000);
    const state = createState({
      running: false,
      wallAnchor: 1000,
      simAnchor: 2.0,
      speedMultiplier: 1,
    });

    reanchorSpeed(state, 4.5, 2, clock);

    // Anchors unchanged
    expect(state.wallAnchor).toBe(1000);
    expect(state.simAnchor).toBe(2.0);
    // Speed still updated
    expect(state.speedMultiplier).toBe(2);
  });
});
