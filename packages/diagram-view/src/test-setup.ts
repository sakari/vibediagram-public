/**
 * jsdom polyfills needed by React Flow in test environment.
 * React Flow uses ResizeObserver for viewport sizing.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(_target: Element, _options?: ResizeObserverOptions): void {}
    unobserve(_target: Element): void {}
    disconnect(): void {}
  };
}
