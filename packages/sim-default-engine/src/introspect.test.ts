import { describe, it, expect } from "vitest";
import {
  Blueprint,
  component,
  createModel,
  Engine,
  metrics,
  Node,
  SENTINEL,
  type SentinelMarker,
} from "@diagram/sim-model";
import { introspect } from "./introspect";

class TestPool extends Blueprint {
  static params = { capacity: component.capacity() };
  declare params: typeof TestPool.params;
  started = false;
  engineOnStart() {
    this.started = true;
  }
}

class TestDB extends Blueprint {
  static params = { pool: component.ref(TestPool) };
  declare params: typeof TestDB.params;
}

class TestServer extends Blueprint {
  static params = {
    db: component.ref(TestDB),
    timeout: component.duration(),
  };
  declare params: typeof TestServer.params;
}

class MultiPool extends Blueprint {
  static params = { pools: component.array(component.ref(TestPool)) };
  declare params: typeof MultiPool.params;
}

class CycleA extends Blueprint {
  // Lazy target form: the arrow defers resolution until introspection, so
  // CycleB can be referenced before it's declared.
  static params = { other: component.ref(() => CycleB) };
  declare params: typeof CycleA.params;
}
class CycleB extends Blueprint {
  static params = { other: component.ref(CycleA) };
  declare params: typeof CycleB.params;
}

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

describe("introspect", () => {
  describe("[resolve-params]", () => {
    it("after resolution instance.params.capacity is the number from the thunk", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      expect(result.registrations).toHaveLength(1);
      expect(pool.params.capacity).toBe(10);
      expect(typeof pool.params.capacity).toBe("number");
    });

    it("instance.params.pool is the TestPool instance", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      model.create("db", TestDB, { pool });
      const engine = makeEngineFactory();
      introspect(model, engine);

      const dbReg = model.registrations.find((r) => r.name === "db");
      expect(dbReg).toBeDefined();
      const dbInstance = dbReg!.instance;
      expect(dbInstance).toBeInstanceOf(TestDB);
      if (!(dbInstance instanceof TestDB)) throw new Error("Expected TestDB");
      expect(dbInstance.params.pool).toBe(pool);
      expect(dbInstance.params.pool).toBeInstanceOf(TestPool);
    });

    it("non-sentinel fields like started are untouched", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      const engine = makeEngineFactory();
      introspect(model, engine);

      expect(pool.started).toBe(false);
    });
  });

  describe("[resolve-nested]", () => {
    it("nested model.create inside thunks are discovered and resolved", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      const server = model.create("server", TestServer, {
        db: model.create("db", TestDB, { pool }),
        timeout: 5,
      });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      const names = result.registrations.map((r) => r.name);
      expect(names).toContain("db");
      expect(result.registrations).toHaveLength(3); // pool, server, db (db created during server thunk)
      const dbReg = result.registrations.find((r) => r.name === "db");
      expect(dbReg).toBeDefined();
      const dbInstance = dbReg!.instance;
      expect(dbInstance).toBeInstanceOf(TestDB);
      if (!(dbInstance instanceof TestDB)) throw new Error("Expected TestDB");
      expect(dbInstance.params.pool).toBe(pool);
      expect(server.params.db).toBe(dbReg!.instance);
    });
  });

  describe("[resolve-forward-refs]", () => {
    it("forward references work: a.params.pool === b after resolution", () => {
      const model = createModel();
      const b = model.create("b", TestPool, { capacity: 10 });
      const a = model.create("a", TestDB, { pool: b });
      const engine = makeEngineFactory();
      introspect(model, engine);

      expect(a.params.pool).toBe(b);
    });
  });

  describe("[resolve-composites]", () => {
    it("component.array(component.ref(TestPool)) resolves correctly", () => {
      const model = createModel();
      const pool1 = model.create("p1", TestPool, { capacity: 5 });
      const pool2 = model.create("p2", TestPool, { capacity: 10 });
      model.create("multi", MultiPool, { pools: [pool1, pool2] });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      const multiReg = result.registrations.find((r) => r.name === "multi");
      expect(multiReg).toBeDefined();
      const multiInstance = multiReg!.instance;
      expect(multiInstance).toBeInstanceOf(MultiPool);
      if (!(multiInstance instanceof MultiPool))
        throw new Error("Expected MultiPool");
      const pools = multiInstance.params.pools;
      expect(pools).toEqual([pool1, pool2]);
      expect(pools[0]).toBe(pool1);
      expect(pools[1]).toBe(pool2);
    });
  });

  describe("[resolve-validation-errors]", () => {
    it("missing param throws error naming the field", () => {
      const model = createModel();
      model.create("pool", TestPool, {});
      const engine = makeEngineFactory();

      expect(() => introspect(model, engine)).toThrow(
        /registration 'pool', field 'capacity': missing/,
      );
    });

    it("wrong type (string instead of number) throws error", () => {
      const model = createModel();
      // @ts-expect-error — deliberately passing string instead of number
      model.create("pool", TestPool, { capacity: "10" });
      const engine = makeEngineFactory();

      expect(() => introspect(model, engine)).toThrow(
        /registration 'pool', field 'capacity': expected number/,
      );
    });

    it("extra key throws error", () => {
      const model = createModel();
      model.create("pool", TestPool, {
        capacity: 10,
        extra: "x",
      } as { capacity: number });
      const engine = makeEngineFactory();

      expect(() => introspect(model, engine)).toThrow(
        /registration 'pool', field 'extra': extra key/,
      );
    });
  });

  describe("[resolve-engine-wired]", () => {
    it("every Blueprint gets a per-node engine facade", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      model.create("db", TestDB, { pool });
      const engine = makeEngineFactory();
      introspect(model, engine);

      expect(pool.engine).toBeDefined();
      expect(typeof pool.engine.random).toBe("function");
      const dbReg = model.registrations.find((r) => r.name === "db");
      const dbInstance = dbReg!.instance;
      expect(dbInstance).toBeInstanceOf(Blueprint);
      if (!(dbInstance instanceof Blueprint))
        throw new Error("Expected Blueprint");
      expect(dbInstance.engine).toBeDefined();
      // Each node gets its own facade
      expect(pool.engine).not.toBe(dbInstance.engine);
    });

    it("engine.timeout is a function (not throwing the default error)", () => {
      const model = createModel();
      model.create("pool", TestPool, { capacity: 10 });
      const engine = makeEngineFactory();
      introspect(model, engine);

      const poolInstance = model.registrations.find(
        (r) => r.name === "pool",
      )!.instance;
      expect(poolInstance).toBeInstanceOf(TestPool);
      if (!(poolInstance instanceof TestPool))
        throw new Error("Expected TestPool");
      expect(typeof poolInstance.engine.timeout).toBe("function");
      expect(() => poolInstance.engine.timeout(1)).not.toThrow();
    });
  });

  describe("[resolve-record-sentinel]", () => {
    class RecordNode extends Blueprint {
      static params = {
        config: component.record({
          timeout: component.duration(),
          pool: component.ref(TestPool),
        }),
      };
      declare params: typeof RecordNode.params;
    }

    it("component.record resolves to nested object with validated fields", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      model.create("rn", RecordNode, {
        config: { timeout: 5, pool },
      });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      const rnReg = result.registrations.find((r) => r.name === "rn");
      expect(rnReg).toBeDefined();
      const rnInstance = rnReg!.instance;
      expect(rnInstance).toBeInstanceOf(RecordNode);
      if (!(rnInstance instanceof RecordNode))
        throw new Error("Expected RecordNode");
      expect(rnInstance.params.config.timeout).toBe(5);
      expect(rnInstance.params.config.pool).toBe(pool);
    });

    it("non-object value for record sentinel throws error", () => {
      const model = createModel();
      model.create("pool", TestPool, { capacity: 10 });
      // @ts-expect-error — deliberately passing string instead of record
      model.create("rn", RecordNode, { config: "bad" });
      const engine = makeEngineFactory();

      expect(() => introspect(model, engine)).toThrow(
        /expected object, got string/,
      );
    });

    it("missing key in record sentinel throws error", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      // @ts-expect-error — deliberately omitting timeout
      model.create("rn", RecordNode, { config: { pool } });
      const engine = makeEngineFactory();

      expect(() => introspect(model, engine)).toThrow(/missing key 'timeout'/);
    });

    it("array value for record sentinel throws error", () => {
      const model = createModel();
      model.create("pool", TestPool, { capacity: 10 });
      // @ts-expect-error — deliberately passing array instead of record
      model.create("rn", RecordNode, { config: [1, 2] });
      const engine = makeEngineFactory();

      expect(() => introspect(model, engine)).toThrow(
        /expected object, got array/,
      );
    });
  });

  describe("[resolve-param-validation]", () => {
    class ParamNode extends Blueprint {
      static params = { tag: component.param() };
      declare params: typeof ParamNode.params;
    }

    it("param accepts string value", () => {
      const model = createModel();
      model.create("pn", ParamNode, { tag: "hello" });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);
      expect(result.registrations).toHaveLength(1);
    });

    it("param accepts number value", () => {
      const model = createModel();
      model.create("pn", ParamNode, { tag: 42 });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);
      expect(result.registrations).toHaveLength(1);
    });

    it("param accepts string[] value", () => {
      const model = createModel();
      model.create("pn", ParamNode, { tag: ["a", "b"] });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);
      expect(result.registrations).toHaveLength(1);
    });

    it("param with non-string array items throws", () => {
      const model = createModel();
      // @ts-expect-error — deliberately passing number[] instead of string[]
      model.create("pn", ParamNode, { tag: [1, 2] });
      const engine = makeEngineFactory();
      expect(() => introspect(model, engine)).toThrow(
        /param array must contain only strings/,
      );
    });

    it("param with object value throws", () => {
      const model = createModel();
      // @ts-expect-error — deliberately passing object
      model.create("pn", ParamNode, { tag: {} });
      const engine = makeEngineFactory();
      expect(() => introspect(model, engine)).toThrow(
        /expected string, number, or string\[\]/,
      );
    });
  });

  describe("[resolve-ref-validation]", () => {
    it("null ref value throws error", () => {
      const model = createModel();
      // @ts-expect-error — deliberately passing null
      model.create("db", TestDB, { pool: null });
      const engine = makeEngineFactory();
      expect(() => introspect(model, engine)).toThrow(
        /expected instance of TestPool, got object/,
      );
    });

    it("wrong class ref value throws error", () => {
      const model = createModel();
      const pool3 = model.create("pool3", TestPool, { capacity: 1 });
      const pool2 = model.create("pool2", TestDB, { pool: pool3 });
      // @ts-expect-error — deliberately passing a TestDB where a TestPool is required
      model.create("db", TestDB, { pool: pool2 });
      const engine = makeEngineFactory();
      expect(() => introspect(model, engine)).toThrow(
        /expected instance of TestPool, got TestDB/,
      );
    });

    it("non-array value for array sentinel throws error", () => {
      const model = createModel();
      // @ts-expect-error — deliberately passing string instead of array
      model.create("multi", MultiPool, { pools: "bad" });
      const engine = makeEngineFactory();
      expect(() => introspect(model, engine)).toThrow(
        /expected array, got string/,
      );
    });
  });

  describe("[resolve-ref-constructor-fallback]", () => {
    it("ref with Object.create(null) reports 'unknown' in error message", () => {
      const model = createModel();
      model.create("db", TestDB, {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately passing object without constructor
        pool: Object.create(null) as TestPool,
      });
      const engine = makeEngineFactory();
      expect(() => introspect(model, engine)).toThrow(
        /expected instance of TestPool, got unknown/,
      );
    });
  });

  describe("[resolve-unknown-sentinel-kind]", () => {
    it("unknown sentinel kind throws descriptive error", () => {
      const model = createModel();
      model.create("pool", TestPool, { capacity: 10 });
      // Inject a sentinel with an unknown kind into the registration
      const reg = model.registrations[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- injecting invalid sentinel for test
      reg.paramsSchema.fake = {
        [SENTINEL]: true,
        kind: "banana",
      } as unknown as SentinelMarker;
      reg.pendingParams = { ...reg.pendingParams, fake: 42 };

      const engine = makeEngineFactory();
      expect(() => introspect(model, engine)).toThrow(
        /unknown sentinel kind 'banana'/,
      );
    });
  });

  describe("[resolve-topo-order]", () => {
    it("linear chain Pool → DB → Server gives startOrder [Pool, DB, Server]", () => {
      const model = createModel();
      const pool = model.create("pool", TestPool, { capacity: 10 });
      const db = model.create("db", TestDB, { pool });
      const server = model.create("server", TestServer, {
        db,
        timeout: 5,
      });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      expect(result.startOrder).toHaveLength(3);
      expect(result.startOrder[0]).toBe(pool);
      expect(result.startOrder[1]).toBe(db);
      expect(result.startOrder[2]).toBe(server);
    });

    it("cycle A refs B, B refs A: order matches registration order", () => {
      const model = createModel();
      const aRef = model.create("a", CycleA);
      const bRef = model.create("b", CycleB, { other: aRef });
      aRef.wire({ other: bRef });
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      expect(result.startOrder).toHaveLength(2);
      expect(result.startOrder[0]).toBe(aRef);
      expect(result.startOrder[1]).toBe(bRef);
      // Resolved params point at the counterpart on both sides — the
      // lazy `component.ref(() => CycleB)` target plus `.wire()` for the
      // back-edge produce the same topology the old thunk-based test
      // exercised.
      expect(aRef.params.other).toBe(bRef);
      expect(bRef.params.other).toBe(aRef);
    });
  });

  describe("[resolve-defaults]", () => {
    it("primitive defaultValue fills missing thunk fields", () => {
      class DefaultPool extends Blueprint {
        static params = { capacity: component.capacity(42) };
        declare params: typeof DefaultPool.params;
      }

      const model = createModel();
      // No thunk — capacity should default to 42
      const pool = model.create("pool", DefaultPool);
      const engine = makeEngineFactory();
      introspect(model, engine);

      expect(pool.params.capacity).toBe(42);
    });

    it("ref defaultFactory auto-creates the referenced node when thunk omits the field", () => {
      class WithCounter extends Blueprint {
        static params = {
          qps: component.ref(metrics.Counter, (m, name) =>
            m.create(name, metrics.Counter),
          ),
        };
        declare params: typeof WithCounter.params;
      }

      const model = createModel();
      // No thunk — ref default factory should create a Counter automatically
      const bp = model.create("test", WithCounter);
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      // The auto-created Counter should exist
      expect(bp.params.qps).toBeInstanceOf(metrics.Counter);
      // It should be registered under the derived name
      const counterReg = result.registrations.find(
        (r) => r.name === "test/qps",
      );
      expect(counterReg).toBeDefined();
      expect(counterReg!.instance).toBe(bp.params.qps);
      // Counter's own default (unit: "count") should have been applied
      expect(bp.params.qps.params.unit).toBe("count");
    });

    it("ref defaultFactory does not override an explicitly provided value", () => {
      class WithCounter extends Blueprint {
        static params = {
          qps: component.ref(metrics.Counter, (m, name) =>
            m.create(name, metrics.Counter),
          ),
        };
        declare params: typeof WithCounter.params;
      }

      const model = createModel();
      const explicit = model.create("my-counter", metrics.Counter, {
        unit: "byte",
      });
      model.create("test", WithCounter, {
        qps: explicit,
      });
      const engine = makeEngineFactory();
      introspect(model, engine);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test helper: narrow Node to WithCounter for assertion access
      const bp = model.registrations.find((r) => r.name === "test")!
        .instance as WithCounter;
      expect(bp.params.qps).toBe(explicit);
      expect(bp.params.qps.params.unit).toBe("byte");
    });

    it("nested ref defaults: factory-created node can itself have defaults", () => {
      class Inner extends Node {
        static params = { rate: component.rate(100) };
        declare params: typeof Inner.params;
      }
      class Outer extends Blueprint {
        static params = {
          child: component.ref(Inner, (m, name) => m.create(name, Inner)),
        };
        declare params: typeof Outer.params;
      }

      const model = createModel();
      model.create("outer", Outer);
      const engine = makeEngineFactory();
      const result = introspect(model, engine);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test helper: narrow Node to Outer for assertion access
      const outerInst = model.registrations.find((r) => r.name === "outer")!
        .instance as Outer;
      expect(outerInst.params.child).toBeInstanceOf(Inner);
      expect(outerInst.params.child.params.rate).toBe(100);
      expect(result.registrations).toHaveLength(2);
    });
  });

  describe("[resolve-metadata]", () => {
    it("label from opts is stored on the registration", () => {
      const model = createModel();
      model.create("pool", TestPool, { capacity: 10 }, { label: "My Pool" });
      const result = introspect(model, makeEngineFactory());
      const reg = result.registrations.find((r) => r.name === "pool")!;
      expect(reg.label).toBe("My Pool");
    });

    it("description from opts is stored on the registration", () => {
      const model = createModel();
      model.create(
        "pool",
        TestPool,
        { capacity: 10 },
        { description: "A connection pool" },
      );
      const result = introspect(model, makeEngineFactory());
      const reg = result.registrations.find((r) => r.name === "pool")!;
      expect(reg.description).toBe("A connection pool");
    });

    it("params object rejects label/description as compile error", () => {
      const model = createModel();
      // @ts-expect-error — label must go in opts, not params
      model.create("p1", TestPool, { capacity: 10, label: "nope" });
      // @ts-expect-error — description must go in opts, not params
      model.create("p2", TestPool, { capacity: 10, description: "nope" });
      // The runtime validator also rejects extra keys, so introspect() throws.
      expect(() => introspect(model, makeEngineFactory())).toThrow(/extra key/);
    });
  });
});
