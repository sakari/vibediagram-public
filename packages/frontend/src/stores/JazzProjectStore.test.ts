import { describe, it, expect } from "vitest";
import { toRole } from "./JazzProjectStore";
import type { ProjectSummary, Role } from "./ProjectStore";
import { exampleProjects } from "@diagram/sim-examples";

describe("toRole", () => {
  it("maps admin to admin", () => {
    expect(toRole("admin")).toBe("admin");
  });

  it("maps writer to writer", () => {
    expect(toRole("writer")).toBe("writer");
  });

  it("maps reader to reader", () => {
    expect(toRole("reader")).toBe("reader");
  });

  it("returns undefined for unknown roles", () => {
    expect(toRole("writeOnly")).toBeUndefined();
    expect(toRole("revoked")).toBeUndefined();
    expect(toRole("adminInvite")).toBeUndefined();
    expect(toRole("readerInvite")).toBeUndefined();
    expect(toRole("writerInvite")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(toRole(undefined)).toBeUndefined();
  });
});

describe("getExampleProjects contract", () => {
  it("returns example metadata with isExample: true", () => {
    // Verify the example data matches the expected ProjectSummary shape
    const examples: ProjectSummary[] = exampleProjects.map((ex) => ({
      id: ex.id,
      title: ex.title,
      description: ex.description,
      createdAt: "",
      updatedAt: "",
      role: "reader" as Role,
      isExample: true,
    }));

    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const ex of examples) {
      expect(ex.isExample).toBe(true);
      expect(ex.role).toBe("reader");
      expect(ex.title).toBeTruthy();
      expect(ex.description).toBeTruthy();
      expect(ex.id).toBeTruthy();
    }
  });

  it("includes known example IDs", () => {
    const ids = exampleProjects.map((ex) => ex.id);
    expect(ids).toContain("cache-layer");
    expect(ids).toContain("load-balancer");
    expect(ids).toContain("worker-pool");
  });
});
