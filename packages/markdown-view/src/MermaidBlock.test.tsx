/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

const renderMock = vi.fn();
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

import { MermaidBlock } from "./MermaidBlock";

beforeEach(() => {
  renderMock.mockReset();
  initializeMock.mockReset();
});

describe("MermaidBlock", () => {
  it("[mb-success] injects rendered SVG once mermaid resolves", async () => {
    renderMock.mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg"></svg>',
    });
    const { container } = render(<MermaidBlock source="graph TD; A-->B;" />);

    await waitFor(() => {
      expect(container.querySelector("svg")).not.toBeNull();
    });
    expect(initializeMock).toHaveBeenCalled();
  });

  it("[mb-error] renders error fallback when mermaid.render rejects", async () => {
    renderMock.mockRejectedValue(new Error("bad diagram"));
    const { container } = render(<MermaidBlock source="not a real diagram" />);

    await waitFor(() => {
      const errEl = container.querySelector(".md-mermaid-error");
      expect(errEl).not.toBeNull();
      expect(errEl!.textContent).toContain("bad diagram");
      expect(errEl!.textContent).toContain("not a real diagram");
    });
  });

  // Covers the non-Error catch branch in MermaidBlock — `mermaid.render`
  // could in principle throw a non-Error value; the component must still
  // surface it via String(e) without crashing.
  it("[mb-error-non-error] handles a non-Error rejection value", async () => {
    renderMock.mockRejectedValue("plain string failure");
    const { container } = render(<MermaidBlock source="bad" />);

    await waitFor(() => {
      const errEl = container.querySelector(".md-mermaid-error");
      expect(errEl).not.toBeNull();
      expect(errEl!.textContent).toContain("plain string failure");
    });
  });

  // Covers the bindFunctions branch in MermaidBlock — when mermaid returns
  // a `bindFunctions` callback (e.g., for click handlers), the component
  // must invoke it with the rendered container.
  it("[mb-bind] invokes bindFunctions when provided", async () => {
    const bindFunctions = vi.fn();
    renderMock.mockResolvedValue({
      svg: "<svg></svg>",
      bindFunctions,
    });
    render(<MermaidBlock source="graph TD; A-->B;" />);

    await waitFor(() => {
      expect(bindFunctions).toHaveBeenCalled();
    });
  });

  // Covers the `if (cancelled) return;` branch inside the catch block —
  // when render rejects after the component has already unmounted, we
  // must not call setState.
  it("[mb-unmount-error] suppresses error state after unmount", async () => {
    let rejectRender: (reason: Error) => void = () => {};
    let renderCalled: () => void = () => {};
    const renderInvoked = new Promise<void>((resolve) => {
      renderCalled = resolve;
    });
    renderMock.mockImplementation(
      () =>
        new Promise<{ svg: string }>((_resolve, reject) => {
          rejectRender = reject;
          renderCalled();
        }),
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const { unmount, container } = render(
        <MermaidBlock source="graph TD; A-->B;" />,
      );
      // Wait until mermaid.render has actually been invoked (i.e. past the
      // await import('mermaid') and initialize calls), so that the rejection
      // routes through the catch block under test.
      await renderInvoked;
      unmount();
      await act(async () => {
        rejectRender(new Error("late failure"));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector(".md-mermaid-error")).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  // Regression: when the source flips from invalid to valid, the error
  // fallback used to stick because the success-path setError(undefined) was
  // skipped — the div had been unmounted under the error pre, so `ref.current`
  // was null and the early return fired before clearing the error.
  it("[mb-recover] clears the error when the source becomes valid again", async () => {
    renderMock.mockRejectedValueOnce(new Error("first try"));
    renderMock.mockResolvedValueOnce({ svg: "<svg></svg>" });

    const { container, rerender } = render(<MermaidBlock source="bad" />);
    await waitFor(() => {
      expect(container.querySelector(".md-mermaid-error")).not.toBeNull();
    });

    rerender(<MermaidBlock source="graph TD; A-->B;" />);
    await waitFor(() => {
      expect(container.querySelector(".md-mermaid-error")).toBeNull();
      expect(container.querySelector("svg")).not.toBeNull();
    });
  });

  it("[mb-unmount] does not setState on unmounted component", async () => {
    let resolveRender: (value: { svg: string }) => void = () => {};
    renderMock.mockImplementation(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          resolveRender = resolve;
        }),
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const { unmount } = render(<MermaidBlock source="graph TD; A-->B;" />);
      // Unmount before the render promise resolves
      unmount();
      // Now resolve it; the cleanup flag should suppress the SVG injection
      // and any setState that would otherwise warn.
      await act(async () => {
        resolveRender({ svg: "<svg></svg>" });
        // Let the microtask queue drain
        await Promise.resolve();
        await Promise.resolve();
      });
      const reactWarnings = consoleErrorSpy.mock.calls.filter(
        (args: unknown[]) => {
          const first = args[0];
          return (
            typeof first === "string" &&
            (first.includes("unmounted") ||
              first.includes("not wrapped in act"))
          );
        },
      );
      expect(reactWarnings).toEqual([]);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
