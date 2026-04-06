import { describe, it, expect } from "vitest";
import { Node } from "./node";
import { Blueprint, Engine } from "./blueprint";

describe("base", () => {
  describe("base-hierarchy", () => {
    it("new Blueprint() instanceof Node is true", () => {
      expect(new Blueprint() instanceof Node).toBe(true);
    });

    it("new Blueprint() instanceof Blueprint is true", () => {
      expect(new Blueprint() instanceof Blueprint).toBe(true);
    });
  });

  describe("Node.defaultStyleRules", () => {
    it("returns an empty array", () => {
      expect(Node.defaultStyleRules()).toEqual([]);
    });

    it("Blueprint inherits defaultStyleRules from Node", () => {
      expect(Blueprint.defaultStyleRules()).toEqual([]);
    });
  });

  describe("base-engine-field", () => {
    it("Blueprint instance has engine property", () => {
      const bp = new Blueprint();
      expect("engine" in bp).toBe(true);
    });

    it("engine.timeout() throws with descriptive message before wiring", () => {
      const bp = new Blueprint();
      bp.engine = new Engine();
      expect(() => bp.engine.timeout(1)).toThrow(
        "Engine not wired — call createEngine() first",
      );
    });

    it("engine.spawn() throws with descriptive message before wiring", () => {
      const bp = new Blueprint();
      bp.engine = new Engine();
      expect(() => bp.engine.spawn("x", Node, () => ({}))).toThrow(
        "Engine not wired — call createEngine() first",
      );
    });

    it("engine.halt() throws with descriptive message before wiring", () => {
      const e = new Engine();
      expect(() => {
        e.halt("test");
      }).toThrow("Engine not wired — call createEngine() first");
    });

    it("engine.random() throws with descriptive message before wiring", () => {
      const e = new Engine();
      expect(() => e.random()).toThrow(
        "Engine not wired — call createEngine() first",
      );
    });
  });

  describe("base-engineOnStart", () => {
    it("engineOnStart() is callable and does not throw", () => {
      const bp = new Blueprint();
      expect(() => {
        bp.engineOnStart();
      }).not.toThrow();
    });
  });
});
