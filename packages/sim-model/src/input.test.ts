import { describe, it, expect } from "vitest";
import { InputNode } from "./input";
import { component, isSentinel } from "./sentinel";

describe("InputNode", () => {
  it("is constructed with sentinel params", () => {
    const node = new InputNode();
    // params should contain sentinel markers before resolution
    expect(isSentinel(node.params.kind)).toBe(true);
    expect(isSentinel(node.params.defaultValue)).toBe(true);
    expect(isSentinel(node.params.min)).toBe(true);
    expect(isSentinel(node.params.max)).toBe(true);
    expect(isSentinel(node.params.step)).toBe(true);
  });

  it("value getter returns 0 by default (before resolution)", () => {
    const node = new InputNode();
    expect(node.value).toBe(0);
  });

  it("value setter changes the returned value", () => {
    const node = new InputNode();
    node.value = 99;
    expect(node.value).toBe(99);
  });

  it("extends Node (has name field)", () => {
    const node = new InputNode();
    expect(node.name).toBe("");
    node.name = "myInput";
    expect(node.name).toBe("myInput");
  });
});

describe("InputNode.defaultStyleRules", () => {
  it("returns a group-child rule for simInput type", () => {
    const rules = InputNode.defaultStyleRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].match).toEqual({ type: "simInput" });
    expect(rules[0].style).toEqual({ display: "group-child" });
  });
});

describe("component sentinel factories (input-related removals)", () => {
  it("component no longer has an input() method", () => {
    expect("input" in component).toBe(false);
  });

  it("component.param() still works as a sentinel", () => {
    const m = component.param();
    expect(isSentinel(m)).toBe(true);
  });
});
