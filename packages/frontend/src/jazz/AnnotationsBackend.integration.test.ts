/**
 * Integration tests for the Annotations CoMap shape and its `useCoState`
 * resolve query, exercised through two Jazz test accounts:
 *
 *  - Account A is a writer of a project (project group member: writer).
 *  - Account B is added to the project group as a reader (cannot write to the
 *    project itself), but the annotations CoMap lives in a separate Group
 *    that is `everyone:"writer"`. So B *can* append strokes and cursor ticks
 *    to the annotations.
 *
 * These tests verify three properties that Task 2 promises:
 *   1. Bootstrap: when a writer creates a project (via createDocument), the
 *      annotations CoMap is set immediately and discoverable from B's view.
 *   2. Read-only viewer can write: B can splice a Stroke into
 *      `annotations.strokes` and append a cursor tick, and A sees both via
 *      Jazz sync.
 *   3. Reactivity: a subscriber on A using the resolve query
 *      `{ annotations: { strokes: { $each: true }, cursors: true } }`
 *      receives a re-notification when B mutates either child.
 *
 * The tests speak directly to the schema CoValues — no JazzAnnotationsBackend
 * adapter (Task 3c) is involved.
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
  DiagramProject,
  FileEntry,
  Stroke,
  Annotations,
} from "@diagram/jazz-schema";
import { createAnnotations } from "../hooks/useJazzDB.js";

/**
 * Create a Stroke owned by the same group as `annotations` so it can be
 * pushed into the strokes list. Returns the Stroke so the caller can assert
 * on it after sync.
 */
function makeStroke(
  annotations: co.loaded<typeof Annotations>,
  authorId: string,
  color = "#123456",
): co.loaded<typeof Stroke> {
  const owner = annotations.$jazz.owner;
  return Stroke.create(
    {
      // The Stroke schema requires a globally-unique id so the eraser tool
      // and backend dedup paths can address an individual stroke without
      // depending on its CoList index.
      id: crypto.randomUUID(),
      view: "diagram",
      pointsJson: JSON.stringify([
        [0, 0],
        [10, 10],
      ]),
      color,
      width: 2,
      authorId,
      createdAt: new Date().toISOString(),
    },
    { owner },
  );
}

describe("Annotations bootstrap and reader-can-write semantics", () => {
  let writer: Account;
  let reader: Account;
  let projectGroup: Group;

  beforeEach(async () => {
    await setupJazzTestSync();

    writer = await createJazzTestAccount({ isCurrentActiveAccount: true });
    reader = await createJazzTestAccount();
    setActiveAccount(writer);

    // Project group: writer is admin (creator), reader is added as reader.
    // Reader cannot write to the project itself — that is the whole point
    // of the separate annotations Group with `everyone:"writer"`.
    projectGroup = Group.create();
    projectGroup.addMember(reader, "reader");
  });

  it("a freshly created project has annotations populated immediately", async () => {
    const annotations = createAnnotations();
    const files = co.list(FileEntry).create([], { owner: projectGroup });
    const project = DiagramProject.create(
      {
        title: "fresh",
        files,
        annotations,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: projectGroup },
    );

    // Read through a deeply-resolved load so the nested CoList /
    // CoFeed children are guaranteed to be resolved — that's the
    // shape the production hook (`useDiagramDocument`) uses.
    const loaded = await DiagramProject.load(project.$jazz.id, {
      resolve: { annotations: { strokes: { $each: true }, cursors: true } },
    });
    expect(loaded).not.toBeNull();
    expect(loaded?.annotations).toBeDefined();
    expect(loaded?.annotations?.strokes.length).toBe(0);
    // Sanity: cursors is a feed and starts empty in our session.
    expect(loaded?.annotations?.cursors).toBeDefined();
  });

  it("a reader can append a Stroke to annotations and the writer sees it via sync", async () => {
    const annotations = createAnnotations();
    const files = co.list(FileEntry).create([], { owner: projectGroup });
    const project = DiagramProject.create(
      {
        title: "reader-write",
        files,
        annotations,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: projectGroup },
    );

    // Load the project from the reader's perspective with the same resolve
    // query as the production hook. This both exercises the resolve shape
    // (typecheck) and gives us a reader-owned handle to append from.
    const projectFromReader = await DiagramProject.load(project.$jazz.id, {
      loadAs: reader,
      resolve: {
        annotations: { strokes: { $each: true }, cursors: true },
      },
    });
    expect(projectFromReader).not.toBeNull();
    if (!projectFromReader) throw new Error("project did not sync to reader");
    const readerAnnotations = projectFromReader.annotations;
    if (!readerAnnotations)
      throw new Error("annotations did not sync to reader");

    // The reader is the current active account for the append; it must
    // succeed even though the reader is only `reader` on the project.
    setActiveAccount(reader);
    const stroke = makeStroke(readerAnnotations, reader.$jazz.id);
    readerAnnotations.strokes.$jazz.push(stroke);

    // Writer sees the new stroke after sync.
    setActiveAccount(writer);
    await waitFor(() => {
      expect(annotations.strokes.length).toBe(1);
      expect(annotations.strokes[0].authorId).toBe(reader.$jazz.id);
    });
  });

  it("a subscriber on the writer fires when the reader appends a stroke (validates resolve query)", async () => {
    const annotations = createAnnotations();
    const files = co.list(FileEntry).create([], { owner: projectGroup });
    const project = DiagramProject.create(
      {
        title: "reactive",
        files,
        annotations,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: projectGroup },
    );

    // Subscribe with the same resolve query the production hook uses.
    const seenStrokeCounts: number[] = [];
    const unsub = DiagramProject.subscribe(
      project.$jazz.id,
      {
        loadAs: writer,
        resolve: {
          annotations: { strokes: { $each: true }, cursors: true },
        },
      },
      (value) => {
        // The annotations field is `co.optional`, so even with the resolve
        // query its type stays `Annotations | undefined`. Guard before use.
        if (!value.annotations) return;
        seenStrokeCounts.push(value.annotations.strokes.length);
      },
    );

    try {
      // Reader pushes a stroke from their own account context.
      const projectFromReader = await DiagramProject.load(project.$jazz.id, {
        loadAs: reader,
        resolve: {
          annotations: { strokes: { $each: true }, cursors: true },
        },
      });
      if (!projectFromReader) throw new Error("project did not sync to reader");
      const readerAnnotations = projectFromReader.annotations;
      if (!readerAnnotations)
        throw new Error("annotations did not sync to reader");
      setActiveAccount(reader);
      const stroke = makeStroke(readerAnnotations, reader.$jazz.id);
      readerAnnotations.strokes.$jazz.push(stroke);

      await waitFor(() => {
        // Subscriber must have seen at least one notification with length 1.
        expect(seenStrokeCounts).toContain(1);
      });
    } finally {
      unsub();
    }
  });

  it("a subscriber on the writer sees a cursor tick the reader appends to the cursors feed", async () => {
    const annotations = createAnnotations();
    const files = co.list(FileEntry).create([], { owner: projectGroup });
    const project = DiagramProject.create(
      {
        title: "cursor-reactive",
        files,
        annotations,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { owner: projectGroup },
    );

    // Same resolve query; collect cursor-feed snapshots.
    const seenTicks: string[] = [];
    const unsub = DiagramProject.subscribe(
      project.$jazz.id,
      {
        loadAs: writer,
        resolve: {
          annotations: { strokes: { $each: true }, cursors: true },
        },
      },
      (value) => {
        if (!value.annotations) return;
        const perAccount = value.annotations.cursors.perAccount;
        // perAccount[id] returns undefined for unknown accounts despite the
        // CoFeed type signature suggesting otherwise — keep the optional chain.
        const entry = perAccount[reader.$jazz.id];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (entry?.value) seenTicks.push(entry.value);
      },
    );

    try {
      const projectFromReader = await DiagramProject.load(project.$jazz.id, {
        loadAs: reader,
        resolve: {
          annotations: { strokes: { $each: true }, cursors: true },
        },
      });
      if (!projectFromReader) throw new Error("project did not sync to reader");
      const readerAnnotations = projectFromReader.annotations;
      if (!readerAnnotations)
        throw new Error("annotations did not sync to reader");
      setActiveAccount(reader);

      const tick = JSON.stringify({
        view: "diagram",
        x: 12,
        y: 34,
        drawing: false,
        name: "Reader",
        t: Date.now(),
      });
      // co.feed item type is z.string(); push the tick.
      readerAnnotations.cursors.$jazz.push(tick);

      await waitFor(() => {
        expect(seenTicks).toContain(tick);
      });
    } finally {
      unsub();
    }
  });
});

/**
 * Poll an assertion until it passes or the timeout elapses. Used because
 * Jazz sync is event-driven and we need to wait for the in-memory sync
 * server to deliver mutations across accounts.
 */
async function waitFor(
  assertion: () => void,
  {
    timeoutMs = 10_000,
    intervalMs = 50,
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
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          resolve();
        }, intervalMs),
      );
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("waitFor: assertion never passed");
}
