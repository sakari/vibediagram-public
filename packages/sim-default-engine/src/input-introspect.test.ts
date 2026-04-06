/**
 * Tests for InputNode resolution during introspection and engine creation.
 *
 * Covers: InputNode as a regular Node resolved via model.create and
 * component.ref, inputRegistry on IntrospectionResult and EngineController,
 * value initialization from params.defaultValue, and mutation visibility.
 */

import { describe, it, expect } from "vitest";
import {
  Blueprint,
  Engine,
  InputNode,
  component,
  createModel,
} from "@diagram/sim-model";
import { introspect } from "./introspect";
import { createEngine } from "./create-engine";

function makeEngineFactory(): (name: string) => Engine {
  return (_name: string) =>
    ({
      timeout(_seconds: number) {
        return Promise.resolve();
      },
      random() {
        return 0;
      },
      halt(_reason: string) {
        // no-op stub
      },
      spawn() {
        throw new Error("not implemented in test stub");
      },
      now() {
        return 0;
      },
    }) as Engine;
}

describe("InputNode introspection", () => {
  describe("[input-resolve]", () => {
    it("InputNode resolves with correct default value after introspection", () => {
      const model = createModel();
      const rate = model.create("rate", InputNode, () => ({
        kind: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 10,
      }));
      const { inputRegistry } = introspect(model, makeEngineFactory());

      const input = inputRegistry.get("rate");
      expect(input).toBeInstanceOf(InputNode);
      expect(input!.value).toBe(10);
      expect(input).toBe(rate);
    });

    it("InputNode params are resolved after introspection", () => {
      const model = createModel();
      const rate = model.create("rate", InputNode, () => ({
        kind: "number",
        min: 0,
        max: 100,
        step: 0.5,
        defaultValue: 5,
      }));
      introspect(model, makeEngineFactory());

      expect(rate.params.kind).toBe("number");
      expect(rate.params.min).toBe(0);
      expect(rate.params.max).toBe(100);
      expect(rate.params.step).toBe(0.5);
      expect(rate.params.defaultValue).toBe(5);
    });
  });

  describe("[input-ref]", () => {
    it("Blueprint can reference InputNode via component.ref", () => {
      class Limiter extends Blueprint {
        params = {
          rate: component.ref(InputNode),
        };
      }

      const model = createModel();
      const rate = model.create("rate", InputNode, () => ({
        kind: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 10,
      }));
      const limiter = model.create("limiter", Limiter, () => ({ rate }));
      introspect(model, makeEngineFactory());

      expect(limiter.params.rate).toBe(rate);
      expect(limiter.params.rate.value).toBe(10);
    });
  });

  describe("[input-handle-mutation]", () => {
    it("mutating InputNode.value is visible from blueprint params", () => {
      class Service extends Blueprint {
        params = {
          throughput: component.ref(InputNode),
        };
      }

      const model = createModel();
      const throughput = model.create("throughput", InputNode, () => ({
        kind: "number",
        min: 1,
        max: 1000,
        step: 1,
        defaultValue: 50,
      }));
      const svc = model.create("svc", Service, () => ({ throughput }));
      const { inputRegistry } = introspect(model, makeEngineFactory());

      const input = inputRegistry.get("throughput")!;
      expect(svc.params.throughput).toBe(input);

      // Simulate UI changing the value
      input.value = 200;
      expect(svc.params.throughput.value).toBe(200);
    });
  });

  describe("[input-coexistence]", () => {
    it("InputNode coexists with regular sentinel params on blueprints", () => {
      class Pool extends Blueprint {
        params = { capacity: component.capacity() };
      }

      class Worker extends Blueprint {
        params = {
          pool: component.ref(Pool),
          speed: component.ref(InputNode),
        };
      }

      const model = createModel();
      const pool = model.create("pool", Pool, () => ({ capacity: 5 }));
      const speed = model.create("speed", InputNode, () => ({
        kind: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 10,
      }));
      model.create("worker", Worker, () => ({ pool, speed }));

      const { registrations, inputRegistry, startOrder } = introspect(
        model,
        makeEngineFactory(),
      );

      expect(registrations).toHaveLength(3);
      // startOrder only includes Blueprints, not plain Nodes like InputNode
      expect(startOrder).toHaveLength(2);

      // Regular param resolved correctly
      expect(pool.params.capacity).toBe(5);

      // InputNode resolved and initialized
      const input = inputRegistry.get("speed");
      expect(input).toBeInstanceOf(InputNode);
      expect(input!.value).toBe(10);

      // Only InputNode instances appear in registry
      expect(inputRegistry.has("pool")).toBe(false);
    });

    it("multiple InputNodes all resolve", () => {
      const model = createModel();
      model.create("rate", InputNode, () => ({
        kind: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 10,
      }));
      model.create("enabled", InputNode, () => ({
        kind: "boolean",
        min: 0,
        max: 1,
        step: 1,
        defaultValue: 1,
      }));
      const { inputRegistry } = introspect(model, makeEngineFactory());

      expect(inputRegistry.get("rate")!.value).toBe(10);
      expect(inputRegistry.get("enabled")!.value).toBe(1);
      expect(inputRegistry.size).toBe(2);
    });
  });

  describe("[input-registry]", () => {
    it("inputRegistry is returned from introspect() with correct keys", () => {
      const model = createModel();
      model.create("x", InputNode, () => ({
        kind: "number",
        min: 0,
        max: 10,
        step: 1,
        defaultValue: 1,
      }));
      model.create("y", InputNode, () => ({
        kind: "boolean",
        min: 0,
        max: 1,
        step: 1,
        defaultValue: 0,
      }));
      const { inputRegistry } = introspect(model, makeEngineFactory());

      expect(inputRegistry.size).toBe(2);
      expect(inputRegistry.has("x")).toBe(true);
      expect(inputRegistry.has("y")).toBe(true);
    });

    it("inputRegistry is available on EngineController from createEngine()", () => {
      const model = createModel();
      model.create("level", InputNode, () => ({
        kind: "number",
        min: 0,
        max: 10,
        step: 1,
        defaultValue: 5,
      }));
      const controller = createEngine(model, { seed: "test-input" });

      expect(controller.inputRegistry).toBeInstanceOf(Map);
      expect(controller.inputRegistry.size).toBe(1);

      const input = controller.inputRegistry.get("level")!;
      expect(input).toBeInstanceOf(InputNode);
      expect(input.value).toBe(5);
    });
  });

  describe("[input-topology]", () => {
    it("InputNode appears in model registrations like any other node", () => {
      const model = createModel();
      model.create("capacity", InputNode, () => ({
        kind: "number",
        min: 1,
        max: 100,
        step: 1,
        defaultValue: 20,
      }));
      const names = model.registrations.map((r) => r.name);
      expect(names).toContain("capacity");
    });
  });
});
