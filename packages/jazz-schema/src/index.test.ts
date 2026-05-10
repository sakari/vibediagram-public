/**
 * Tests for VibeDiagramAccount migration logic and schema construction.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupJazzTestSync, createJazzTestAccount } from "jazz-tools/testing";
import { co, z, Group } from "jazz-tools";
import {
  VibeDiagramAccount,
  Stroke,
  Annotations,
  DiagramProject,
  FileEntry,
} from "./index.js";

describe("VibeDiagramAccount migration", () => {
  beforeEach(async () => {
    await setupJazzTestSync();
  });

  it("initializes root with empty projects on new account", async () => {
    const account = await createJazzTestAccount({
      AccountSchema: VibeDiagramAccount,
      isCurrentActiveAccount: true,
    });

    expect(account.root).toBeDefined();
    expect(account.root.projects).toBeDefined();
    expect(account.root.projects.length).toBe(0);
  });
});

describe("Annotations schema", () => {
  beforeEach(async () => {
    await setupJazzTestSync();
    await createJazzTestAccount({ isCurrentActiveAccount: true });
  });

  // The Annotations CoMap is the per-project drawing surface. Constructing it
  // with empty children and then appending a stroke is the minimum end-to-end
  // shape any backend will rely on, so it is the first thing to verify.
  it("constructs with empty strokes/cursors and accepts an appended stroke", () => {
    const group = Group.create();
    const annotations = Annotations.create(
      {
        strokes: co.list(Stroke).create([], { owner: group }),
        cursors: co.feed(z.string()).create([], { owner: group }),
      },
      { owner: group },
    );

    expect(annotations.strokes.length).toBe(0);

    const strokeId = crypto.randomUUID();
    const stroke = Stroke.create(
      {
        id: strokeId,
        view: "diagram",
        pointsJson: JSON.stringify([
          [0, 0],
          [10, 10],
        ]),
        color: "#ff0000",
        width: 2,
        authorId: "test-author",
        createdAt: new Date().toISOString(),
      },
      { owner: group },
    );
    annotations.strokes.$jazz.push(stroke);

    expect(annotations.strokes.length).toBe(1);
    const readBack = annotations.strokes[0];
    expect(readBack).toBeDefined();
    expect(readBack.id).toBe(strokeId);
    expect(readBack.view).toBe("diagram");
    expect(readBack.color).toBe("#ff0000");
  });

  // pointsJson is the load-bearing serialisation contract for strokes — every
  // backend round-trips through it. Verify a non-trivial array survives.
  it("round-trips pointsJson on a Stroke", () => {
    const group = Group.create();
    const original: number[][] = [
      [1, 2],
      [3, 4],
    ];
    const stroke = Stroke.create(
      {
        id: crypto.randomUUID(),
        view: "markdown",
        filePath: "/notes.md",
        pointsJson: JSON.stringify(original),
        color: "#00ff00",
        width: 3,
        authorId: "author-1",
        createdAt: new Date().toISOString(),
      },
      { owner: group },
    );

    const parsed: unknown = JSON.parse(stroke.pointsJson);
    expect(parsed).toEqual(original);
    expect(stroke.filePath).toBe("/notes.md");
  });

  // The annotations field is optional so existing DiagramProject documents
  // (which predate the drawing overlay) continue to load. Constructing a
  // project without annotations must succeed.
  it("constructs a DiagramProject without annotations (field is optional)", () => {
    const group = Group.create();
    const files = co.list(FileEntry).create([], { owner: group });
    const project = DiagramProject.create(
      {
        title: "Legacy Project",
        files,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: group },
    );

    expect(project.title).toBe("Legacy Project");
    expect(project.annotations).toBeUndefined();
  });
});
