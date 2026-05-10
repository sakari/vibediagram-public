/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCursors } from "./useCursors";
import { InMemoryAnnotationsBackend } from "./test-helpers/InMemoryAnnotationsBackend";
import type { CursorTick } from "./types";

/**
 * Test backend wrapper that records every accepted outbound tick so we
 * can assert on throttling without coupling the test to the backend's
 * internal map shape.
 */
class RecordingBackend extends InMemoryAnnotationsBackend {
  public readonly outbound: CursorTick[] = [];
  override writeCursorTick(tick: CursorTick): void {
    this.outbound.push(tick);
    super.writeCursorTick(tick);
  }
}

describe("useCursors", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[uc-throttle] drops writes inside the 50 ms throttle window", () => {
    vi.setSystemTime(new Date("2026-05-10T00:00:00Z"));
    const backend = new RecordingBackend("me");
    const { result } = renderHook(() =>
      useCursors(backend, { view: "diagram" }, { name: "Alice" }),
    );

    // Five rapid-fire calls at the same wall-clock instant: only the
    // first should be accepted.
    act(() => {
      for (let i = 0; i < 5; i++) {
        result.current.writeTick({ x: i, y: i, drawing: false });
      }
    });

    expect(backend.outbound).toHaveLength(1);
    expect(backend.outbound[0]).toEqual(
      expect.objectContaining({
        x: 0,
        y: 0,
        drawing: false,
        name: "Alice",
        view: "diagram",
      }),
    );
  });

  it("[uc-window-elapsed] accepts the next tick once 50 ms have passed", () => {
    vi.setSystemTime(new Date("2026-05-10T00:00:00Z"));
    const backend = new RecordingBackend("me");
    const { result } = renderHook(() =>
      useCursors(backend, { view: "diagram" }, { name: "Alice" }),
    );

    act(() => {
      result.current.writeTick({ x: 0, y: 0, drawing: false });
    });
    expect(backend.outbound).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    act(() => {
      result.current.writeTick({ x: 10, y: 10, drawing: true });
    });
    expect(backend.outbound).toHaveLength(2);
    expect(backend.outbound[1]).toEqual(
      expect.objectContaining({ x: 10, y: 10, drawing: true }),
    );
  });

  it("[uc-stale-filter] hides remote ticks older than 2000 ms", () => {
    const now = new Date("2026-05-10T00:00:00Z").getTime();
    vi.setSystemTime(new Date(now));
    const backend = new RecordingBackend("me");

    // Pre-populate a stale remote tick (3 seconds old) before mounting.
    backend.writeCursorTickAs("remote-bob", {
      view: "diagram",
      x: 1,
      y: 2,
      drawing: false,
      name: "Bob",
      t: now - 3000,
    });

    const { result } = renderHook(() =>
      useCursors(backend, { view: "diagram" }, { name: "Alice" }),
    );

    expect(result.current.otherCursors).toEqual([]);
  });

  it("[uc-fresh-included] includes remote ticks that are not stale", () => {
    const now = new Date("2026-05-10T00:00:00Z").getTime();
    vi.setSystemTime(new Date(now));
    const backend = new RecordingBackend("me");

    const { result } = renderHook(() =>
      useCursors(backend, { view: "diagram" }, { name: "Alice" }),
    );

    act(() => {
      backend.writeCursorTickAs("remote-bob", {
        view: "diagram",
        x: 5,
        y: 6,
        drawing: false,
        name: "Bob",
        t: now,
      });
    });

    expect(result.current.otherCursors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Bob", x: 5, y: 6 }),
      ]),
    );
    expect(result.current.otherCursors).toHaveLength(1);
  });

  it("[uc-stale-sweep] periodically drops ticks that age past the cutoff", () => {
    const now = new Date("2026-05-10T00:00:00Z").getTime();
    vi.setSystemTime(new Date(now));
    const backend = new RecordingBackend("me");

    const { result } = renderHook(() =>
      useCursors(backend, { view: "diagram" }, { name: "Alice" }),
    );

    act(() => {
      backend.writeCursorTickAs("remote-bob", {
        view: "diagram",
        x: 5,
        y: 6,
        drawing: false,
        name: "Bob",
        t: now,
      });
    });
    expect(result.current.otherCursors).toHaveLength(1);

    // Advance past staleness — sweep timer must force a re-render so
    // the filter picks the change up without a backend notification.
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(result.current.otherCursors).toEqual([]);
  });

  it("[uc-own-name] embeds the supplied display name in every outbound tick", () => {
    const now = new Date("2026-05-10T00:00:00Z").getTime();
    vi.setSystemTime(new Date(now));
    const backend = new RecordingBackend("me");
    const { result } = renderHook(() =>
      useCursors(
        backend,
        { view: "markdown", filePath: "/a.md" },
        { name: "Alice" },
      ),
    );

    act(() => {
      result.current.writeTick({ x: 1, y: 2, drawing: true });
    });

    expect(backend.outbound[0]).toEqual(
      expect.objectContaining({
        view: "markdown",
        filePath: "/a.md",
        name: "Alice",
        t: now,
      }),
    );
  });
});
