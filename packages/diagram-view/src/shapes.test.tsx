/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { isSvgShape, renderShape } from "./shapes";
import { buildNodeStyle } from "./node-style";

describe("isSvgShape", () => {
  it("returns true for SVG shapes: cylinder, diamond, circle, hexagon", () => {
    expect(isSvgShape("cylinder")).toBe(true);
    expect(isSvgShape("diamond")).toBe(true);
    expect(isSvgShape("circle")).toBe(true);
    expect(isSvgShape("hexagon")).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isSvgShape(undefined)).toBe(false);
  });

  it("returns false for CSS-only shapes: rectangle, rounded-rectangle", () => {
    expect(isSvgShape("rectangle")).toBe(false);
    expect(isSvgShape("rounded-rectangle")).toBe(false);
  });
});

describe("renderShape", () => {
  it("cylinder renders SVG with ellipse elements", () => {
    const { container } = render(renderShape("cylinder", "#111", "#222", 1));
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const ellipses = container.querySelectorAll("ellipse");
    expect(ellipses.length).toBeGreaterThanOrEqual(2);
  });

  it("diamond renders SVG with a polygon element", () => {
    const { container } = render(renderShape("diamond", "#111", "#222", 1));
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("polygon")).not.toBeNull();
  });

  it("circle renders SVG with an ellipse element", () => {
    const { container } = render(renderShape("circle", "#111", "#222", 1));
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("ellipse")).not.toBeNull();
  });

  it("hexagon renders SVG with a polygon element", () => {
    const { container } = render(renderShape("hexagon", "#111", "#222", 1));
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("polygon")).not.toBeNull();
  });

  it("applies provided fill and stroke colors", () => {
    const { container } = render(
      renderShape("diamond", "#aabbcc", "#ddeeff", 2),
    );
    const polygon = container.querySelector("polygon")!;
    expect(polygon.getAttribute("fill")).toBe("#aabbcc");
    expect(polygon.getAttribute("stroke")).toBe("#ddeeff");
    expect(polygon.getAttribute("stroke-width")).toBe("2");
  });

  it("circle applies provided fill and stroke colors", () => {
    const { container } = render(
      renderShape("circle", "#112233", "#445566", 3),
    );
    const ellipse = container.querySelector("ellipse")!;
    expect(ellipse.getAttribute("fill")).toBe("#112233");
    expect(ellipse.getAttribute("stroke")).toBe("#445566");
    expect(ellipse.getAttribute("stroke-width")).toBe("3");
  });

  it("rectangle renders SVG with no shape children (does not crash)", () => {
    const { container } = render(renderShape("rectangle", "#111", "#222", 1));
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // No polygon, ellipse, or rect children inside
    expect(svg!.querySelector("polygon")).toBeNull();
    expect(svg!.querySelector("ellipse")).toBeNull();
  });

  it("rounded-rectangle renders SVG with no shape children (does not crash)", () => {
    const { container } = render(
      renderShape("rounded-rectangle", "#111", "#222", 1),
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelector("polygon")).toBeNull();
    expect(svg!.querySelector("ellipse")).toBeNull();
  });
});

describe("buildNodeStyle with shapes", () => {
  it("suppresses background, border, and boxShadow for SVG shapes", () => {
    const result = buildNodeStyle({
      background: "#ff0000",
      borderColor: "#00ff00",
      borderWidth: 2,
      boxShadow: "0 0 8px red",
      shape: "diamond",
    });
    // All visual props are suppressed for SVG shapes; only opacity would survive
    expect(result).toBeUndefined();
  });

  it("preserves opacity for SVG shapes", () => {
    const result = buildNodeStyle({
      background: "#ff0000",
      opacity: 0.5,
      shape: "cylinder",
    });
    expect(result).toBeDefined();
    expect(result!.opacity).toBe(0.5);
    expect(result!.background).toBeUndefined();
  });

  it("emits all properties for rectangle shape", () => {
    const result = buildNodeStyle({
      background: "#ff0000",
      borderColor: "#00ff00",
      boxShadow: "0 0 8px red",
      shape: "rectangle",
    });
    expect(result).toBeDefined();
    expect(result!.background).toBe("#ff0000");
    expect(result!.borderColor).toBe("#00ff00");
    expect(result!.boxShadow).toBe("0 0 8px red");
  });

  it("emits all properties when shape is undefined", () => {
    const result = buildNodeStyle({
      background: "#ff0000",
      borderColor: "#00ff00",
    });
    expect(result).toBeDefined();
    expect(result!.background).toBe("#ff0000");
    expect(result!.borderColor).toBe("#00ff00");
  });
});
