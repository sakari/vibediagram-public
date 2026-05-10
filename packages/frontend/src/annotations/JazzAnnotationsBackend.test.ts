/**
 * Integration tests for {@link JazzAnnotationsBackend}.
 *
 * These tests exercise the adapter through the public
 * {@link AnnotationsBackend} interface using two Jazz test accounts,
 * mirroring the production scenario:
 *
 *  - Account A is a writer on the project Group.
 *  - Account B is a reader on the project Group, but the annotations
 *    Group (created by `createAnnotations()`) is `everyone:"writer"` so
 *    B can still draw and emit cursors.
 *
 * The tests cover stroke roundtrip, scope filtering, reader-write,
 * scope-local clearing, subscription fanout, cursor roundtrip, own-cursor
 * filtering, and the snapshot-stability contract that
 * `useSyncExternalStore` relies on.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setupJazzTestSync,
  createJazzTestAccount,
  setActiveAccount,
} from "jazz-tools/testing";
import { co, Group, type Account } from "jazz-tools";
import {
  Annotations,
  DiagramProject,
  FileEntry,
  Stroke,
} from "@diagram/jazz-schema";
import type { StrokeData, StrokeScope } from "@diagram/draw-overlay";
import { createAnnotations } from "../hooks/useJazzDB.js";
import { JazzAnnotationsBackend } from "./JazzAnnotationsBackend.js";

const DIAGRAM: StrokeScope = { view: "diagram" };
const MARKDOWN_README: StrokeScope = {
  view: "markdown",
  filePath: "/README.md",
};

interface SetupResult {
  writer: Account;
  reader: Account;
  // The annotations CoMap as seen by the writer (deeply loaded).
  writerAnnotations: co.loaded<
    typeof Annotations,
    { strokes: { $each: true }; cursors: true }
  >;
  // The annotations CoMap as seen by the reader (deeply loaded via Jazz sync).
  readerAnnotations: co.loaded<
    typeof Annotations,
    { strokes: { $each: true }; cursors: true }
  >;
  writerBackend: JazzAnnotationsBackend;
  readerBackend: JazzAnnotationsBackend;
  projectId: string;
}

async function setupTwoAccountProject(): Promise<SetupResult> {
  await setupJazzTestSync();

  const writer = await createJazzTestAccount({ isCurrentActiveAccount: true });
  const reader = await createJazzTestAccount();
  setActiveAccount(writer);

  const projectGroup = Group.create();
  projectGroup.addMember(reader, "reader");

  const writerAnnotations = createAnnotations();
  const files = co.list(FileEntry).create([], { owner: projectGroup });
  const project = DiagramProject.create(
    {
      title: "test",
      files,
      annotations: writerAnnotations,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { owner: projectGroup },
  );

  // Load the project from the reader's perspective so the reader's backend
  // has its own deeply-loaded handle (matches how the production hook
  // resolves nested annotations).
  const projectFromReader = await DiagramProject.load(project.$jazz.id, {
    loadAs: reader,
    resolve: { annotations: { strokes: { $each: true }, cursors: true } },
  });
  if (!projectFromReader || !projectFromReader.annotations) {
    throw new Error("project did not sync to reader");
  }
  const readerAnnotations = projectFromReader.annotations;

  return {
    writer,
    reader,
    writerAnnotations,
    readerAnnotations,
    writerBackend: new JazzAnnotationsBackend(writerAnnotations, writer),
    readerBackend: new JazzAnnotationsBackend(readerAnnotations, reader),
    projectId: project.$jazz.id,
  };
}

function makeStrokeData(
  authorId: string,
  overrides: Partial<StrokeData> = {},
): StrokeData {
  const base: StrokeData = {
    id: `local-${Math.random().toString(36).slice(2)}`,
    view: "diagram",
    points: [
      [0, 0],
      [10, 10],
    ],
    color: "#aabbcc",
    width: 2,
    authorId,
    createdAt: Date.now(),
  };
  return { ...base, ...overrides };
}

describe("JazzAnnotationsBackend", () => {
  let ctx: SetupResult;

  beforeEach(async () => {
    ctx = await setupTwoAccountProject();
  });

  it("appendStroke roundtrips a stroke through readStrokes", async () => {
    setActiveAccount(ctx.writer);
    const stroke = makeStrokeData(ctx.writer.$jazz.id, {
      points: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    });
    await ctx.writerBackend.appendStroke(stroke);

    const list = ctx.writerBackend.readStrokes(DIAGRAM);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(
      expect.objectContaining({
        view: "diagram",
        color: stroke.color,
        width: stroke.width,
        authorId: stroke.authorId,
        points: stroke.points,
      }),
    );
  });

  it("readStrokes filters by scope (diagram vs markdown filePath)", async () => {
    setActiveAccount(ctx.writer);
    await ctx.writerBackend.appendStroke(
      makeStrokeData(ctx.writer.$jazz.id, { view: "diagram" }),
    );
    await ctx.writerBackend.appendStroke(
      makeStrokeData(ctx.writer.$jazz.id, {
        view: "markdown",
        filePath: "/README.md",
      }),
    );
    await ctx.writerBackend.appendStroke(
      makeStrokeData(ctx.writer.$jazz.id, {
        view: "markdown",
        filePath: "/other.md",
      }),
    );

    expect(ctx.writerBackend.readStrokes(DIAGRAM)).toHaveLength(1);
    expect(ctx.writerBackend.readStrokes(MARKDOWN_README)).toHaveLength(1);
    expect(
      ctx.writerBackend.readStrokes({
        view: "markdown",
        filePath: "/other.md",
      }),
    ).toHaveLength(1);
  });

  it("a reader on the project can append a stroke and the writer sees it via sync", async () => {
    setActiveAccount(ctx.reader);
    const readerStroke = makeStrokeData(ctx.reader.$jazz.id, {
      color: "#ff0000",
    });
    await ctx.readerBackend.appendStroke(readerStroke);

    setActiveAccount(ctx.writer);
    await waitFor(() => {
      const list = ctx.writerBackend.readStrokes(DIAGRAM);
      expect(list.map((s) => s.authorId)).toContain(ctx.reader.$jazz.id);
    });
  });

  it("clearStrokes removes only strokes in the given scope", async () => {
    setActiveAccount(ctx.writer);
    await ctx.writerBackend.appendStroke(
      makeStrokeData(ctx.writer.$jazz.id, { view: "diagram" }),
    );
    await ctx.writerBackend.appendStroke(
      makeStrokeData(ctx.writer.$jazz.id, {
        view: "markdown",
        filePath: "/README.md",
      }),
    );

    await ctx.writerBackend.clearStrokes(DIAGRAM);

    expect(ctx.writerBackend.readStrokes(DIAGRAM)).toHaveLength(0);
    expect(ctx.writerBackend.readStrokes(MARKDOWN_README)).toHaveLength(1);
  });

  it("subscribeStrokes fires when a remote account appends a stroke", async () => {
    let notifications = 0;
    const unsub = ctx.writerBackend.subscribeStrokes(DIAGRAM, () => {
      notifications++;
    });
    try {
      setActiveAccount(ctx.reader);
      await ctx.readerBackend.appendStroke(makeStrokeData(ctx.reader.$jazz.id));
      await waitFor(() => {
        expect(notifications).toBeGreaterThan(0);
        // After the subscription fires, the writer must observe the new
        // stroke via the same backend instance.
        expect(ctx.writerBackend.readStrokes(DIAGRAM)).toHaveLength(1);
      });
    } finally {
      unsub();
    }
  });

  it("writeCursorTick from B is visible to A via readOtherCursors", async () => {
    setActiveAccount(ctx.reader);
    const tick = {
      view: "diagram" as const,
      x: 12,
      y: 34,
      drawing: false,
      name: "Reader",
      t: Date.now(),
    };
    ctx.readerBackend.writeCursorTick(tick);

    setActiveAccount(ctx.writer);
    await waitFor(() => {
      const others = ctx.writerBackend.readOtherCursors(DIAGRAM);
      expect(others).toEqual(
        expect.arrayContaining([expect.objectContaining({ x: 12, y: 34 })]),
      );
    });
  });

  it("readOtherCursors excludes the local user's own ticks", async () => {
    setActiveAccount(ctx.writer);
    ctx.writerBackend.writeCursorTick({
      view: "diagram",
      x: 1,
      y: 1,
      drawing: false,
      name: "Writer",
      t: Date.now(),
    });

    // Even after a moment for the write to settle, A's backend must not
    // surface its own cursor.
    await sleep(50);
    expect(ctx.writerBackend.readOtherCursors(DIAGRAM)).toHaveLength(0);
  });

  it("a reader can erase a stroke and the writer sees it disappear via sync", async () => {
    // Mirrors the read-only-can-write contract: the annotations Group is
    // `everyone:"writer"`, so a project reader can splice an existing
    // stroke out via deleteStroke. This is the eraser-tool round-trip.
    setActiveAccount(ctx.writer);
    const stroke = makeStrokeData(ctx.writer.$jazz.id, {
      id: `to-erase-${Math.random().toString(36).slice(2)}`,
    });
    await ctx.writerBackend.appendStroke(stroke);

    // Wait for the reader to see the stroke first; otherwise the splice
    // could race the initial sync.
    setActiveAccount(ctx.reader);
    await waitFor(() => {
      const list = ctx.readerBackend.readStrokes(DIAGRAM);
      expect(list.map((s) => s.id)).toContain(stroke.id);
    });

    await ctx.readerBackend.deleteStroke(stroke.id);

    setActiveAccount(ctx.writer);
    await waitFor(() => {
      const list = ctx.writerBackend.readStrokes(DIAGRAM);
      expect(list.map((s) => s.id)).not.toContain(stroke.id);
    });
  });

  it("readStrokes silently skips strokes with malformed pointsJson (no render-path crash)", async () => {
    setActiveAccount(ctx.writer);
    await ctx.writerBackend.appendStroke(makeStrokeData(ctx.writer.$jazz.id));

    // A peer with everyone:"writer" access can push arbitrary JSON. We must
    // not crash the React render path if pointsJson is invalid.
    const owner = ctx.writerAnnotations.$jazz.owner;
    const malformed = Stroke.create(
      {
        id: crypto.randomUUID(),
        view: "diagram",
        pointsJson: "{not valid json",
        color: "#000",
        width: 1,
        authorId: ctx.writer.$jazz.id,
        createdAt: new Date().toISOString(),
      },
      { owner },
    );
    ctx.writerAnnotations.strokes.$jazz.push(malformed);

    // The malformed stroke is silently skipped; the well-formed one survives.
    const list = ctx.writerBackend.readStrokes(DIAGRAM);
    expect(list).toHaveLength(1);
    expect(list[0].id).not.toBe(malformed.id);
  });

  it("readStrokes returns the same array reference until the data changes", async () => {
    setActiveAccount(ctx.writer);
    await ctx.writerBackend.appendStroke(makeStrokeData(ctx.writer.$jazz.id));

    const a = ctx.writerBackend.readStrokes(DIAGRAM);
    const b = ctx.writerBackend.readStrokes(DIAGRAM);
    expect(Object.is(a, b)).toBe(true);

    await ctx.writerBackend.appendStroke(makeStrokeData(ctx.writer.$jazz.id));
    const c = ctx.writerBackend.readStrokes(DIAGRAM);
    expect(Object.is(a, c)).toBe(false);
    expect(c).toHaveLength(2);
  });
});

/** Poll until `assertion` passes; rethrow last error after `timeoutMs`. */
async function waitFor(
  assertion: () => void,
  {
    timeoutMs = 10_000,
    intervalMs = 25,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await sleep(intervalMs);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("waitFor: assertion never passed");
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) =>
    setTimeout(() => {
      resolve();
    }, ms),
  );
}
