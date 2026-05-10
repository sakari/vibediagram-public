/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { DrawOverlay } from "./DrawOverlay";
import { InMemoryAnnotationsBackend } from "./test-helpers/InMemoryAnnotationsBackend";
import type { CoordTransform, StrokeData } from "./types";

/**
 * Identity transform: client coordinates pass through unchanged. Lets the
 * tests reason in pixels and skips any host-view math.
 *
 * `subscribe` exposes the registered callback so a test can simulate a
 * pan/zoom/scroll if it cares to.
 */
function makeIdentityTransform(): CoordTransform & {
  notify(): void;
  subscriberCount(): number;
} {
  const subscribers = new Set<() => void>();
  return {
    toContent(clientX, clientY) {
      return { x: clientX, y: clientY };
    },
    toScreen(x, y) {
      return { left: x, top: y };
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    notify() {
      for (const cb of [...subscribers]) cb();
    },
    subscriberCount() {
      return subscribers.size;
    },
  };
}

/**
 * `setPointerCapture` and friends are not implemented in jsdom; install
 * spies on every SVG/Element prototype so the overlay can call them
 * without throwing and tests can assert on the calls.
 */
function installPointerCaptureStubs(): {
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
  hasPointerCapture: ReturnType<typeof vi.fn>;
} {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  // Default to "yes, captured" so the release path runs in finishStroke.
  const hasPointerCapture = vi.fn().mockReturnValue(true);
  // Patch on Element prototype so any element under test inherits.
  // Element.prototype already has these slots in lib.dom; assign via
  // index access to avoid an unsafe `as` cast.
  Element.prototype.setPointerCapture = setPointerCapture;
  Element.prototype.releasePointerCapture = releasePointerCapture;
  Element.prototype.hasPointerCapture = hasPointerCapture;
  return { setPointerCapture, releasePointerCapture, hasPointerCapture };
}

/**
 * jsdom's `requestAnimationFrame` polyfill triggers asynchronously via a
 * setTimeout. The component's RAF flush is synchronous-ish, but we need
 * a way to drive the queued frame deterministically. We replace it with
 * a manually-flushed queue.
 */
function installManualRAF(): { flush: () => void } {
  const queue: FrameRequestCallback[] = [];
  const originalRAF = globalThis.requestAnimationFrame;
  const originalCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queue.push(cb);
    return queue.length;
  };
  globalThis.cancelAnimationFrame = (handle: number): void => {
    // Best-effort cancel: clear the slot so flush skips it.
    if (handle >= 1 && handle <= queue.length) {
      queue[handle - 1] = (): void => {
        // intentionally empty: this slot was cancelled
      };
    }
  };
  // Restore on test teardown.
  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
  });
  return {
    flush() {
      const pending = queue.splice(0, queue.length);
      for (const cb of pending) cb(performance.now());
    },
  };
}

describe("DrawOverlay", () => {
  beforeEach(() => {
    // Each test gets fresh prototype stubs; vi.fn() handles the rest.
    installPointerCaptureStubs();
  });

  it("[do-disabled-renders-nothing] returns no DOM when enabled is false", () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={false}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );

    // Hard invariant from the plan: no <svg>, no wrapper <div>.
    expect(container.querySelector("svg")).toBeNull();
    expect(container.children).toHaveLength(0);
    // Nothing subscribed either — we never even reached the active body.
    expect(transform.subscriberCount()).toBe(0);
  });

  it("[do-pointer-capture] sets pointer capture on pointerdown", () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#f00"
        width={3}
        authorId="me"
        authorName="Me"
      />,
    );

    const svg = container.querySelector("svg");
    if (svg === null)
      throw new Error("expected an <svg> in the rendered overlay");
    // Spy must be installed on the actual element instance returned
    // here, not just the prototype, so the assertion can target it.
    const setPointerCapture = vi.fn();
    svg.setPointerCapture = setPointerCapture;

    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 10,
      clientY: 20,
      button: 0,
    });

    expect(setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("[do-stroke-append] writes one stroke through the backend on pointerup", async () => {
    installManualRAF();
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#0f0"
        width={4}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
      button: 0,
    });
    fireEvent.pointerMove(svg, {
      pointerId: 1,
      clientX: 15,
      clientY: 25,
    });
    // The pointermove path defers work to a RAF flush; in the
    // synchronous handler-driven test path we instead rely on the
    // pointerup-mediated finishStroke to ship whatever is in the buffer.
    fireEvent.pointerUp(svg, {
      pointerId: 1,
      clientX: 15,
      clientY: 25,
    });

    // Allow the fire-and-forget append promise to resolve.
    await act(async () => {
      await Promise.resolve();
    });

    const strokes = backend.readStrokes({ view: "diagram" });
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0];
    expect(stroke).toEqual(
      expect.objectContaining({
        view: "diagram",
        color: "#0f0",
        width: 4,
        authorId: "me",
      }),
    );
    // First point comes from pointerdown; subsequent points only land if
    // the RAF flushed before pointerup, which is environment-specific.
    // Assert the first point is present and that all points came from
    // the events we fired.
    expect(stroke.points.length).toBeGreaterThanOrEqual(1);
    expect(stroke.points[0]).toEqual([5, 5]);
    for (const [x, y] of stroke.points) {
      expect([5, 15]).toContain(x);
      expect([5, 25]).toContain(y);
    }
  });

  it("[do-cursor-tick] writes a cursor tick when the pointer moves over the overlay", () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    // Spy on writeCursorTick to assert it was called regardless of the
    // throttle internals.
    const writeSpy = vi.spyOn(backend, "writeCursorTick");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#00f"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;

    fireEvent.pointerEnter(svg, { clientX: 1, clientY: 1 });
    fireEvent.pointerMove(svg, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });

    expect(writeSpy).toHaveBeenCalled();
    const tick = writeSpy.mock.calls[0][0];
    expect(tick).toEqual(
      expect.objectContaining({
        view: "diagram",
        x: 10,
        y: 10,
        drawing: false,
        name: "Me",
      }),
    );
  });

  it("[do-existing-strokes-rendered] renders strokes already in the backend", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const stroke: StrokeData = {
      id: "stroke-1",
      view: "diagram",
      points: [
        [10, 20],
        [30, 40],
        [50, 60],
      ],
      color: "#abc",
      width: 5,
      authorId: "remote-bob",
      createdAt: Date.now(),
    };
    await backend.appendStroke(stroke);

    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );

    // Two paths exist: the rendered committed stroke + the always-mounted
    // live in-progress path placeholder. Filter to ones with a `d` set.
    const allPaths = Array.from(container.querySelectorAll("path"));
    const drawn = allPaths.filter(
      (p) => (p.getAttribute("d") ?? "").length > 0,
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0].getAttribute("d")).toMatch(/^M\s+10\s+20\s+L\s+30\s+40/);
  });

  it("[do-transform-resubscribes] re-renders when the transform notifies a change", () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { unmount } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );

    // Active overlay registers exactly one transform subscriber.
    expect(transform.subscriberCount()).toBe(1);

    // Notify is the contract used by host views on pan/zoom/scroll.
    // The test asserts the call does not throw and the subscriber
    // remains registered (no leak).
    act(() => {
      transform.notify();
    });
    expect(transform.subscriberCount()).toBe(1);

    // Unmount must release the subscription and any pending RAF /
    // sweep-interval handles (no leak across mounts).
    unmount();
    expect(transform.subscriberCount()).toBe(0);
  });

  it("[do-secondary-button-ignored] pointerdown with a non-primary button does not start a stroke", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, {
      pointerId: 7,
      clientX: 1,
      clientY: 1,
      button: 2,
    });
    fireEvent.pointerUp(svg, {
      pointerId: 7,
      clientX: 1,
      clientY: 1,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(backend.readStrokes({ view: "diagram" })).toHaveLength(0);
  });

  it("[do-pointer-cancel] pointercancel during a stroke commits whatever was drawn", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
      button: 0,
    });
    fireEvent.pointerCancel(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
    });
    await act(async () => {
      await Promise.resolve();
    });
    // A single-point stroke is still a stroke; the test only cares the
    // gesture went through the pointercancel branch without throwing
    // and produced a backend write.
    const strokes = backend.readStrokes({ view: "diagram" });
    expect(strokes).toHaveLength(1);
  });

  it("[do-toContent-null-skips] pointerdown is a no-op when the transform rejects the point", async () => {
    const backend = new InMemoryAnnotationsBackend("me");
    // Rejecting transform: `toContent` returns null for everything.
    const transform: CoordTransform = {
      toContent: () => null,
      toScreen: (x, y) => ({ left: x, top: y }),
      subscribe: () => () => {},
    };
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
      button: 0,
    });
    fireEvent.pointerMove(svg, {
      pointerId: 1,
      clientX: 6,
      clientY: 6,
    });
    fireEvent.pointerUp(svg, {
      pointerId: 1,
      clientX: 7,
      clientY: 7,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(backend.readStrokes({ view: "diagram" })).toHaveLength(0);
  });

  it("[do-raf-flush] mid-stroke pointermove appends a point through the RAF flush", async () => {
    const raf = installManualRAF();
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    // Two moves at the same RAF — the second one wins (coalesced).
    fireEvent.pointerMove(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(svg, {
      pointerId: 1,
      clientX: 11,
      clientY: 12,
    });
    // Drive the queued RAF callback so the flush actually mutates state.
    act(() => {
      raf.flush();
    });
    fireEvent.pointerUp(svg, {
      pointerId: 1,
      clientX: 11,
      clientY: 12,
    });
    await act(async () => {
      await Promise.resolve();
    });
    const strokes = backend.readStrokes({ view: "diagram" });
    expect(strokes).toHaveLength(1);
    // First point from pointerdown (0,0); second from the coalesced
    // pointermove flush (11,12). Pointerup did not append again because
    // the buffer already has the latest position.
    expect(strokes[0].points).toEqual([
      [0, 0],
      [11, 12],
    ]);
  });

  it("[do-hover-toContent-null] hover pointermove is silently ignored when toContent rejects", () => {
    const backend = new InMemoryAnnotationsBackend("me");
    const writeSpy = vi.spyOn(backend, "writeCursorTick");
    const transform: CoordTransform = {
      toContent: () => null,
      toScreen: (x, y) => ({ left: x, top: y }),
      subscribe: () => () => {},
    };
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;
    // No active stroke -> takes the hover branch.
    fireEvent.pointerMove(svg, {
      pointerId: 1,
      clientX: 1,
      clientY: 1,
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("[do-pointer-leave-noop] pointerleave does not break a captured stroke", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 1,
      clientY: 1,
      button: 0,
    });
    // Pointer leaves the SVG bounding box but capture is still active.
    fireEvent.pointerLeave(svg, { pointerId: 1, clientX: -10, clientY: -10 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: -10, clientY: -10 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(backend.readStrokes({ view: "diagram" })).toHaveLength(1);
  });

  it("[do-other-cursor-rendered] renders a cursor marker for every fresh remote tick", () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    backend.writeCursorTickAs("remote-bob", {
      view: "diagram",
      x: 30,
      y: 40,
      drawing: false,
      name: "Bob",
      t: Date.now(),
    });
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const cursorGroups = container.querySelectorAll(".draw-overlay-cursor");
    expect(cursorGroups).toHaveLength(1);
    const text = cursorGroups[0].querySelector("text");
    expect(text?.textContent).toBe("Bob");
    expect(cursorGroups[0].getAttribute("transform")).toBe("translate(30, 40)");
  });

  it("[do-microtask-fallback] flushes the in-progress point via microtask when requestAnimationFrame is missing", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    // Strip RAF/CAF so the component takes the microtask branch.
    const originalRAF = globalThis.requestAnimationFrame;
    const originalCAF = globalThis.cancelAnimationFrame;
    // @ts-expect-error - intentionally remove for test
    globalThis.requestAnimationFrame = undefined;
    // @ts-expect-error - intentionally remove for test
    globalThis.cancelAnimationFrame = undefined;
    try {
      const { container } = render(
        <DrawOverlay
          enabled={true}
          mode="diagram"
          transform={transform}
          backend={backend}
          color="#000"
          width={2}
          authorId="me"
          authorName="Me"
        />,
      );
      const svg = container.querySelector("svg")!;
      fireEvent.pointerDown(svg, {
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        button: 0,
      });
      fireEvent.pointerMove(svg, {
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
      // Drain any queued microtasks so the flush runs.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      fireEvent.pointerUp(svg, {
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
      await act(async () => {
        await Promise.resolve();
      });
      const strokes = backend.readStrokes({ view: "diagram" });
      expect(strokes).toHaveLength(1);
      expect(strokes[0].points).toContainEqual([10, 10]);
    } finally {
      globalThis.requestAnimationFrame = originalRAF;
      globalThis.cancelAnimationFrame = originalCAF;
    }
  });

  it("[do-release-capture-throws] swallows errors from releasePointerCapture", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg");
    if (svg === null)
      throw new Error("expected an <svg> in the rendered overlay");
    // Force the catch branch on this specific element.
    svg.hasPointerCapture = (): boolean => true;
    svg.releasePointerCapture = (): void => {
      throw new Error("boom");
    };
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
      button: 0,
    });
    // Expect no throw: the pointerup handler must swallow the
    // releasePointerCapture failure and still commit the stroke.
    expect(() =>
      fireEvent.pointerUp(svg, {
        pointerId: 1,
        clientX: 5,
        clientY: 5,
      }),
    ).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(backend.readStrokes({ view: "diagram" })).toHaveLength(1);
  });

  it("[do-eraser-pointerdown-noop] eraser-mode pointerdown on empty space does not start a stroke", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const appendSpy = vi.spyOn(backend, "appendStroke");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
        tool="eraser"
      />,
    );
    const svg = container.querySelector("svg");
    if (svg === null)
      throw new Error("expected an <svg> in the rendered overlay");
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
      button: 0,
    });
    fireEvent.pointerUp(svg, {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
    });
    await act(async () => {
      await Promise.resolve();
    });
    // No backend write — the eraser has nothing to erase and pen-down is
    // suppressed.
    expect(appendSpy).not.toHaveBeenCalled();
    expect(backend.readStrokes({ view: "diagram" })).toHaveLength(0);
  });

  it("[do-eraser-deletes-stroke] eraser-mode pointerdown on a persisted stroke deletes it", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const stroke: StrokeData = {
      id: "to-delete",
      view: "diagram",
      points: [
        [10, 20],
        [30, 40],
      ],
      color: "#abc",
      width: 5,
      authorId: "remote-bob",
      createdAt: Date.now(),
    };
    await backend.appendStroke(stroke);
    const deleteSpy = vi.spyOn(backend, "deleteStroke");

    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
        tool="eraser"
      />,
    );

    // Find the persisted stroke path by its data-stroke-id attribute so
    // the test isn't coupled to render order.
    const path = container.querySelector(`path[data-stroke-id="${stroke.id}"]`);
    if (path === null) throw new Error("expected the persisted stroke path");

    await act(async () => {
      fireEvent.pointerDown(path, {
        pointerId: 1,
        clientX: 10,
        clientY: 20,
        button: 0,
      });
      await Promise.resolve();
    });

    expect(deleteSpy).toHaveBeenCalledWith(stroke.id);
    expect(backend.readStrokes({ view: "diagram" })).toHaveLength(0);
  });

  it("[do-eraser-secondary-button] eraser-mode pointerdown with a non-primary button does not erase", async () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const stroke: StrokeData = {
      id: "stay-put",
      view: "diagram",
      points: [
        [10, 20],
        [30, 40],
      ],
      color: "#abc",
      width: 5,
      authorId: "remote-bob",
      createdAt: Date.now(),
    };
    await backend.appendStroke(stroke);
    const deleteSpy = vi.spyOn(backend, "deleteStroke");

    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
        tool="eraser"
      />,
    );
    const path = container.querySelector(`path[data-stroke-id="${stroke.id}"]`);
    if (path === null) throw new Error("expected the persisted stroke path");
    fireEvent.pointerDown(path, {
      pointerId: 1,
      clientX: 10,
      clientY: 20,
      button: 2,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("[do-eraser-cursor-class] eraser tool applies the eraser cursor class on the root svg", () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
        tool="eraser"
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("draw-overlay-eraser");
  });

  it("[do-pen-cursor-class] pen tool (default) applies the pen cursor class on the root svg", () => {
    const transform = makeIdentityTransform();
    const backend = new InMemoryAnnotationsBackend("me");
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("draw-overlay-pen");
  });

  it("[do-other-cursor-toscreen-null] cursor whose toScreen returns null is skipped", () => {
    const backend = new InMemoryAnnotationsBackend("me");
    backend.writeCursorTickAs("remote-bob", {
      view: "diagram",
      x: 1,
      y: 2,
      drawing: false,
      name: "Bob",
      t: Date.now(),
    });
    // Transform that rejects every projection: the cursor and the
    // committed strokes both get filtered out (so the empty-d render
    // branch in the strokes map runs too).
    const transform: CoordTransform = {
      toContent: (clientX, clientY) => ({ x: clientX, y: clientY }),
      toScreen: () => null,
      subscribe: () => () => {},
    };
    // Pre-populate a stroke so the `d.length === 0` skip path also runs.
    void backend.appendStroke({
      id: "stroke-skip",
      view: "diagram",
      points: [[1, 2]],
      color: "#000",
      width: 1,
      authorId: "remote-bob",
      createdAt: Date.now(),
    });
    const { container } = render(
      <DrawOverlay
        enabled={true}
        mode="diagram"
        transform={transform}
        backend={backend}
        color="#000"
        width={2}
        authorId="me"
        authorName="Me"
      />,
    );
    expect(container.querySelectorAll(".draw-overlay-cursor")).toHaveLength(0);
    // Only the always-mounted live in-progress path remains — the
    // committed stroke whose `d` was empty is not rendered.
    const paths = Array.from(container.querySelectorAll("path"));
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute("d")).toBe("");
  });
});
