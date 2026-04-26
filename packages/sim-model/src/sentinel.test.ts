import { describe, it, expect } from "vitest";
import {
  SENTINEL,
  component,
  isSentinel,
  type RefSentinel,
  type NumericSentinel,
  type ParamSentinel,
  type ArraySentinel,
  type RecordSentinel,
  type ResolveParams,
  type SentinelMarker,
} from "./sentinel";

/** Narrows a value to SentinelMarker via runtime check. For testing sentinel internals. */
function sentinel(value: unknown): SentinelMarker {
  if (!isSentinel(value)) throw new Error("Expected sentinel");
  return value;
}

abstract class ResourcePool {
  declare capacity: number;
}
abstract class Server {
  declare name: string;
}

describe("sentinel", () => {
  describe("sentinels-leaf", () => {
    it("capacity() produces marker with kind and SENTINEL symbol", () => {
      const m = sentinel(component.capacity());
      expect(m[SENTINEL]).toBe(true);
      expect(m.kind).toBe("capacity");
      expect(isSentinel(component.capacity())).toBe(true);
    });

    it("rate() produces marker with kind and SENTINEL symbol", () => {
      const m = sentinel(component.rate());
      expect(m[SENTINEL]).toBe(true);
      expect(m.kind).toBe("rate");
      expect(isSentinel(component.rate())).toBe(true);
    });

    it("duration() produces marker with kind and SENTINEL symbol", () => {
      const m = sentinel(component.duration());
      expect(m[SENTINEL]).toBe(true);
      expect(m.kind).toBe("duration");
      expect(isSentinel(component.duration())).toBe(true);
    });

    it("param() produces marker with kind and SENTINEL symbol", () => {
      const m = sentinel(component.param());
      expect(m[SENTINEL]).toBe(true);
      expect(m.kind).toBe("param");
      expect(isSentinel(component.param())).toBe(true);
    });

    it("ref(Class) produces marker with kind, target, and SENTINEL symbol", () => {
      const m = sentinel(component.ref(ResourcePool));
      expect(m[SENTINEL]).toBe(true);
      expect(m.kind).toBe("ref");
      if (m.kind !== "ref") throw new Error("expected ref sentinel");
      expect(m.target).toBe(ResourcePool);
      expect(isSentinel(component.ref(ResourcePool))).toBe(true);
    });

    it("ref(() => Class) defers target resolution until first read", () => {
      // The lazy arrow form is the escape hatch for circular static-params
      // schemas: it lets CycleA reference CycleB before CycleB is declared.
      // We instrument the arrow with a side-effect counter to prove the
      // implementation does not call it eagerly at component.ref() time.
      let calls = 0;
      const lazy = () => {
        calls++;
        return ResourcePool;
      };
      const m = sentinel(component.ref(lazy));
      expect(m.kind).toBe("ref");
      if (m.kind !== "ref") throw new Error("expected ref sentinel");
      expect(calls).toBe(0); // arrow not yet invoked
      expect(m.target).toBe(ResourcePool);
      expect(calls).toBe(1); // first access resolves
      expect(m.target).toBe(ResourcePool);
      expect(calls).toBe(1); // second access hits the cache
    });

    it("isSentinel returns false for null, undefined, numbers, strings, plain objects", () => {
      expect(isSentinel(null)).toBe(false);
      expect(isSentinel(undefined)).toBe(false);
      expect(isSentinel(42)).toBe(false);
      expect(isSentinel("hello")).toBe(false);
      expect(isSentinel({})).toBe(false);
      expect(isSentinel({ [SENTINEL]: false })).toBe(false);
      expect(isSentinel({ kind: "capacity" })).toBe(false);
    });
  });

  describe("sentinels-composite", () => {
    it("array() produces nested marker with inner sentinel", () => {
      const inner = component.ref(Server);
      const m = sentinel(component.array(inner));
      expect(m[SENTINEL]).toBe(true);
      expect(m.kind).toBe("array");
      if (m.kind !== "array") throw new Error("expected array sentinel");
      expect(m.inner).toBe(inner);
      expect(m.inner[SENTINEL]).toBe(true);
      expect(m.inner.kind).toBe("ref");
      if (m.inner.kind !== "ref") throw new Error("expected ref sentinel");
      expect(m.inner.target).toBe(Server);
      expect(isSentinel(component.array(inner))).toBe(true);
      expect(isSentinel(m.inner)).toBe(true);
    });

    it("record() produces nested marker with shape", () => {
      const shape = {
        timeout: component.duration(),
        retries: component.param(),
      };
      const m = sentinel(component.record(shape));
      expect(m[SENTINEL]).toBe(true);
      expect(m.kind).toBe("record");
      if (m.kind !== "record") throw new Error("expected record sentinel");
      expect(m.shape).toBe(shape);
      expect(isSentinel(m.shape["timeout"])).toBe(true);
      expect(m.shape["timeout"].kind).toBe("duration");
      expect(isSentinel(m.shape["retries"])).toBe(true);
      expect(m.shape["retries"].kind).toBe("param");
      expect(isSentinel(component.record(shape))).toBe(true);
    });
  });

  describe("sentinels-resolve-type", () => {
    it("ResolveParams maps sentinel types to runtime types", () => {
      type AssertEqual<T, U> = [T] extends [U]
        ? [U] extends [T]
          ? true
          : false
        : false;

      type TestParams = {
        pool: RefSentinel<typeof ResourcePool>;
        capacity: NumericSentinel;
      };
      const refCapacity: AssertEqual<
        ResolveParams<TestParams>,
        { pool: ResourcePool; capacity: number }
      > = true;
      expect(refCapacity).toBe(true);
    });

    it("ResolveParams maps param to string | number | string[]", () => {
      type AssertEqual<T, U> = [T] extends [U]
        ? [U] extends [T]
          ? true
          : false
        : false;

      type TestParams = { value: ParamSentinel };
      const paramCheck: AssertEqual<
        ResolveParams<TestParams>,
        { value: string | number | string[] }
      > = true;
      expect(paramCheck).toBe(true);
    });

    it("ResolveParams maps array of refs to array of instances", () => {
      type AssertEqual<T, U> = [T] extends [U]
        ? [U] extends [T]
          ? true
          : false
        : false;

      type TestParams = { servers: ArraySentinel<RefSentinel<typeof Server>> };
      const arrayCheck: AssertEqual<
        ResolveParams<TestParams>,
        { servers: Server[] }
      > = true;
      expect(arrayCheck).toBe(true);
    });

    it("ResolveParams maps record shape to nested object", () => {
      type AssertEqual<T, U> = [T] extends [U]
        ? [U] extends [T]
          ? true
          : false
        : false;

      type TestParams = {
        config: RecordSentinel<{
          timeout: NumericSentinel;
          retries: ParamSentinel;
        }>;
      };
      const recordCheck: AssertEqual<
        ResolveParams<TestParams>,
        { config: { timeout: number; retries: string | number | string[] } }
      > = true;
      expect(recordCheck).toBe(true);
    });
  });
});
