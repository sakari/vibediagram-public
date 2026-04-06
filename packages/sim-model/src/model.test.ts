import { describe, it, expect } from "vitest";
import { component, isSentinel } from "./sentinel";
import { Node } from "./node";
import { Blueprint } from "./blueprint";
import { createModel } from "./model";
import type { StyleRuleDescriptor } from "./style-rule-descriptor";

class TestPool extends Blueprint {
  params = { capacity: component.capacity() };
}

class TestDB extends Blueprint {
  params = { pool: component.ref(TestPool) };
}

class TestNodeWithFrameworkSentinel extends Node {
  params = {};
  frameworkField = component.param();
}

describe("model", () => {
  describe("model-create", () => {
    it("model.create('pool', TestPool, thunk) returns a TestPool instance", () => {
      const model = createModel();
      const instance = model.create("pool", TestPool, () => ({ capacity: 10 }));
      expect(instance).toBeInstanceOf(TestPool);
      expect(instance.name).toBe("pool");
      expect(instance.params.capacity).toBeDefined();
      expect(isSentinel(instance.params.capacity)).toBe(true);

      const reg = model.registrations.find((r) => r.name === "pool")!;
      expect(reg.paramsSchema.capacity.kind).toBe("capacity");
    });

    it("registration has undefined label when opts is omitted", () => {
      const model = createModel();
      model.create("pool", TestPool, () => ({ capacity: 10 }));
      const reg = model.registrations.find((r) => r.name === "pool")!;
      expect(reg.label).toBeUndefined();
    });

    it("registration stores label when opts.label is provided", () => {
      const model = createModel();
      model.create("pool", TestPool, () => ({ capacity: 10 }), {
        label: "My Label",
      });
      const reg = model.registrations.find((r) => r.name === "pool")!;
      expect(reg.label).toBe("My Label");
    });

    it("registration has undefined label when opts.label is explicitly undefined", () => {
      const model = createModel();
      model.create("pool", TestPool, () => ({ capacity: 10 }), {
        label: undefined,
      });
      const reg = model.registrations.find((r) => r.name === "pool")!;
      expect(reg.label).toBeUndefined();
    });

    it("registration stores description when opts.description is provided", () => {
      const model = createModel();
      model.create("pool", TestPool, () => ({ capacity: 10 }), {
        description: "A pool for database connections",
      });
      const reg = model.registrations.find((r) => r.name === "pool")!;
      expect(reg.description).toBe("A pool for database connections");
    });

    it("registration has undefined description when opts is omitted", () => {
      const model = createModel();
      model.create("pool", TestPool, () => ({ capacity: 10 }));
      const reg = model.registrations.find((r) => r.name === "pool")!;
      expect(reg.description).toBeUndefined();
    });

    it("thunk can include label and description in return type", () => {
      const model = createModel();
      // Should compile without type errors
      model.create("pool", TestPool, () => ({
        capacity: 10,
        label: "From Thunk",
        description: "Thunk desc",
      }));
      // Thunk metadata is extracted during introspection, not create().
      // See introspect.test.ts for the full round-trip test.
    });
  });

  describe("model-create-no-thunk", () => {
    it("model.create without thunk stores an empty-object thunk", () => {
      class AllDefaults extends Node {
        params = { rate: component.rate(42) };
      }
      const model = createModel();
      const instance = model.create("ad", AllDefaults);
      expect(instance).toBeInstanceOf(AllDefaults);
      const reg = model.registrations.find((r) => r.name === "ad")!;
      // The stored thunk should return an empty object (defaults applied during introspection)
      expect(reg.thunk()).toEqual({});
    });
  });

  describe("model-schema", () => {
    it("paramsSchema reflects sentinel structure: ref has kind ref and target", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, () => ({ capacity: 5 }));
      model.create("db", TestDB, () => ({ pool }));
      const registrations = model.registrations;
      const poolReg = registrations.find((r) => r.name === "pool");
      const dbReg = registrations.find((r) => r.name === "db");
      expect(poolReg).toBeDefined();
      expect(dbReg).toBeDefined();

      expect(poolReg!.paramsSchema.capacity).toBeDefined();

      expect(poolReg!.paramsSchema.capacity.kind).toBe("capacity");

      expect(dbReg!.paramsSchema.pool).toBeDefined();

      expect(dbReg!.paramsSchema.pool.kind).toBe("ref");
      const poolSentinel = dbReg!.paramsSchema.pool;
      if (poolSentinel.kind !== "ref") throw new Error("expected ref sentinel");
      expect(poolSentinel.target).toBe(TestPool);
    });
  });

  describe("model-framework-sentinels", () => {
    it("Blueprint has empty frameworkSentinels (engine is not a sentinel)", () => {
      const model = createModel();
      model.create("pool", TestPool, () => ({ capacity: 5 }));
      const reg = model.registrations.find((r) => r.name === "pool");

      expect(reg!.frameworkSentinels).toEqual([]);
    });

    it("class with sentinel outside params records it in frameworkSentinels", () => {
      const model = createModel();
      model.create("n", TestNodeWithFrameworkSentinel, () => ({}));
      const reg = model.registrations.find((r) => r.name === "n");

      expect(reg!.frameworkSentinels).toHaveLength(1);

      expect(reg!.frameworkSentinels[0].path).toBe("frameworkField");

      expect(reg!.frameworkSentinels[0].sentinel.kind).toBe("param");
    });
  });

  describe("model-registrations", () => {
    it("all registered nodes are enumerable via model.registrations in insertion order", () => {
      const model = createModel();
      const pool = model.create("first", TestPool, () => ({ capacity: 1 }));
      model.create("second", TestDB, () => ({ pool }));
      model.create("third", TestPool, () => ({ capacity: 3 }));
      const regs = model.registrations;
      expect(regs).toHaveLength(3);
      expect(regs[0].name).toBe("first");
      expect(regs[1].name).toBe("second");
      expect(regs[2].name).toBe("third");
    });
  });

  describe("model-type-safety", () => {
    it("thunk returning wrong shape for params produces compile error", () => {
      const model = createModel();
      // @ts-expect-error — capacity should be number, not string
      model.create("bad", TestPool, () => ({ capacity: "wrong" }));
    });
  });

  describe("blueprint-default-style-rules", () => {
    it("Blueprint.defaultStyleRules() returns [] by default", () => {
      expect(Blueprint.defaultStyleRules()).toEqual([]);
    });

    it("new Blueprint().defaultInstanceStyleRules() returns [] by default", () => {
      const bp = new Blueprint();
      expect(bp.defaultInstanceStyleRules()).toEqual([]);
    });

    it("registration captures defaultInstanceStyleRules from a subclass that overrides it", () => {
      class StyledPool extends Blueprint {
        params = { capacity: component.capacity() };
        defaultInstanceStyleRules() {
          return [
            {
              match: { id: this.name },
              style: { background: "#abc" },
            },
          ];
        }
      }
      const model = createModel();
      model.create("sp", StyledPool, () => ({ capacity: 1 }));
      const reg = model.registrations.find((r) => r.name === "sp")!;
      expect(reg.defaultInstanceStyleRules).toBeDefined();
      expect(reg.defaultInstanceStyleRules).toHaveLength(1);
      expect(reg.defaultInstanceStyleRules![0]).toEqual(
        expect.objectContaining({ match: { id: "sp" } }),
      );
    });

    it("registration has undefined defaultInstanceStyleRules when Blueprint returns []", () => {
      const model = createModel();
      model.create("pool", TestPool, () => ({ capacity: 5 }));
      const reg = model.registrations.find((r) => r.name === "pool")!;
      expect(reg.defaultInstanceStyleRules).toBeUndefined();
    });

    it("sub-subclass can call super.defaultInstanceStyleRules() to inherit and extend", () => {
      class BaseStyled extends Blueprint {
        params = {};
        defaultInstanceStyleRules(): StyleRuleDescriptor[] {
          return [{ match: { id: this.name }, style: { opacity: 0.5 } }];
        }
      }
      class DerivedStyled extends BaseStyled {
        defaultInstanceStyleRules(): StyleRuleDescriptor[] {
          return [
            ...super.defaultInstanceStyleRules(),
            { match: { id: this.name }, style: { borderWidth: 3 } },
          ];
        }
      }
      const model = createModel();
      model.create("d", DerivedStyled, () => ({}));
      const reg = model.registrations.find((r) => r.name === "d")!;
      expect(reg.defaultInstanceStyleRules).toHaveLength(2);
      expect(reg.defaultInstanceStyleRules![0].style).toEqual(
        expect.objectContaining({ opacity: 0.5 }),
      );
      expect(reg.defaultInstanceStyleRules![1].style).toEqual(
        expect.objectContaining({ borderWidth: 3 }),
      );
    });

    it("static defaultStyleRules chains via super in sub-subclasses", () => {
      class BaseClass extends Blueprint {
        params = {};
        static defaultStyleRules() {
          return [
            {
              match: { data: { className: "BaseClass" } },
              style: { background: "base" },
            },
          ];
        }
      }
      class DerivedClass extends BaseClass {
        static defaultStyleRules() {
          return [
            ...super.defaultStyleRules(),
            {
              match: { data: { className: "DerivedClass" } },
              style: { background: "derived" },
            },
          ];
        }
      }
      const rules = DerivedClass.defaultStyleRules();
      expect(rules).toHaveLength(2);
      expect(rules[0].style).toEqual(
        expect.objectContaining({ background: "base" }),
      );
      expect(rules[1].style).toEqual(
        expect.objectContaining({ background: "derived" }),
      );
    });
  });

  describe("model-style-rules", () => {
    it("styleRules starts empty", () => {
      const model = createModel();
      expect(model.styleRules).toEqual([]);
    });

    it("addStyleRules appends rules", () => {
      const model = createModel();
      model.addStyleRules([
        {
          name: "source-nodes",
          match: { topology: { inDegree: 0 } },
          style: { background: "#00ff00" },
        },
      ]);
      expect(model.styleRules).toHaveLength(1);
      expect(model.styleRules[0].name).toBe("source-nodes");
    });

    it("multiple addStyleRules calls accumulate", () => {
      const model = createModel();
      model.addStyleRules([
        { match: { type: "default" }, style: { background: "#111" } },
      ]);
      model.addStyleRules([
        { match: { id: "db" }, style: { borderColor: "#222" } },
      ]);
      expect(model.styleRules).toHaveLength(2);
    });
  });
});
