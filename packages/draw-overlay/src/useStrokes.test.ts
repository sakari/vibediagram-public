/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStrokes } from "./useStrokes";
import { InMemoryAnnotationsBackend } from "./test-helpers/InMemoryAnnotationsBackend";
import type { StrokeData, StrokeScope } from "./types";

const makeStroke = (overrides: Partial<StrokeData> = {}): StrokeData => ({
  id: overrides.id ?? `stroke-${Math.random().toString(36).slice(2)}`,
  view: overrides.view ?? "diagram",
  filePath: overrides.filePath,
  points: overrides.points ?? [
    [0, 0],
    [1, 1],
  ],
  color: overrides.color ?? "#000",
  width: overrides.width ?? 2,
  authorId: overrides.authorId ?? "author-A",
  createdAt: overrides.createdAt ?? Date.now(),
});

describe("useStrokes", () => {
  it("[us-append] surfaces an appended stroke and triggers a re-render", async () => {
    const backend = new InMemoryAnnotationsBackend("me");
    const scope: StrokeScope = { view: "diagram" };

    const { result } = renderHook(() => useStrokes(backend, scope));
    expect(result.current.strokes).toEqual([]);

    const stroke = makeStroke({ view: "diagram" });
    await act(async () => {
      await result.current.append(stroke);
    });

    expect(result.current.strokes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: stroke.id })]),
    );
    expect(result.current.strokes).toHaveLength(1);
  });

  it("[us-scope-isolation] each scope only sees its own strokes", async () => {
    const backend = new InMemoryAnnotationsBackend("me");

    const { result: diagramResult } = renderHook(() =>
      useStrokes(backend, { view: "diagram" }),
    );
    const { result: markdownResult } = renderHook(() =>
      useStrokes(backend, { view: "markdown", filePath: "/notes.md" }),
    );

    const diagramStroke = makeStroke({ view: "diagram" });
    const markdownStroke = makeStroke({
      view: "markdown",
      filePath: "/notes.md",
    });

    await act(async () => {
      await diagramResult.current.append(diagramStroke);
      await markdownResult.current.append(markdownStroke);
    });

    expect(diagramResult.current.strokes).toHaveLength(1);
    expect(diagramResult.current.strokes[0]?.id).toBe(diagramStroke.id);
    expect(markdownResult.current.strokes).toHaveLength(1);
    expect(markdownResult.current.strokes[0]?.id).toBe(markdownStroke.id);
  });

  it("[us-clear] clearAll empties the scope and triggers a re-render", async () => {
    const backend = new InMemoryAnnotationsBackend("me");
    const scope: StrokeScope = { view: "markdown", filePath: "/x.md" };
    const { result } = renderHook(() => useStrokes(backend, scope));

    await act(async () => {
      await result.current.append(
        makeStroke({ view: "markdown", filePath: "/x.md" }),
      );
      await result.current.append(
        makeStroke({ view: "markdown", filePath: "/x.md" }),
      );
    });
    expect(result.current.strokes).toHaveLength(2);

    await act(async () => {
      await result.current.clearAll();
    });

    expect(result.current.strokes).toEqual([]);
  });

  it("[us-erase] erase removes the matching stroke and triggers a re-render", async () => {
    const backend = new InMemoryAnnotationsBackend("me");
    const scope: StrokeScope = { view: "diagram" };
    const { result } = renderHook(() => useStrokes(backend, scope));

    const first = makeStroke({ view: "diagram", id: "first" });
    const second = makeStroke({ view: "diagram", id: "second" });
    await act(async () => {
      await result.current.append(first);
      await result.current.append(second);
    });
    expect(result.current.strokes).toHaveLength(2);

    await act(async () => {
      await result.current.erase(first.id);
    });

    // Only the second stroke remains; ordering is preserved.
    expect(result.current.strokes).toHaveLength(1);
    expect(result.current.strokes[0]?.id).toBe(second.id);
  });

  it("[us-erase-unknown-id] erase is a no-op for an unknown id", async () => {
    const backend = new InMemoryAnnotationsBackend("me");
    const scope: StrokeScope = { view: "diagram" };
    const { result } = renderHook(() => useStrokes(backend, scope));

    const only = makeStroke({ view: "diagram", id: "only" });
    await act(async () => {
      await result.current.append(only);
    });
    const before = result.current.strokes;

    await act(async () => {
      await result.current.erase("does-not-exist");
    });

    // Snapshot reference is preserved when nothing changed; the data
    // certainly is.
    expect(result.current.strokes).toBe(before);
    expect(result.current.strokes).toHaveLength(1);
    expect(result.current.strokes[0]?.id).toBe(only.id);
  });

  it("[us-other-scope-untouched] clearAll only clears the bound scope", async () => {
    const backend = new InMemoryAnnotationsBackend("me");
    const { result: diagram } = renderHook(() =>
      useStrokes(backend, { view: "diagram" }),
    );
    const { result: markdown } = renderHook(() =>
      useStrokes(backend, { view: "markdown", filePath: "/a.md" }),
    );

    await act(async () => {
      await diagram.current.append(makeStroke({ view: "diagram" }));
      await markdown.current.append(
        makeStroke({ view: "markdown", filePath: "/a.md" }),
      );
    });

    await act(async () => {
      await diagram.current.clearAll();
    });

    expect(diagram.current.strokes).toEqual([]);
    expect(markdown.current.strokes).toHaveLength(1);
  });
});
