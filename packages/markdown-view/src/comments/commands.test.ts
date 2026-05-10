/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  ChangeSet,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  insertInlineComment,
  insertBlockComment,
  appendThreadReply,
  toggleThreadResolved,
} from "./commands";

const makeView = (initial: string): EditorView => {
  const state = EditorState.create({ doc: initial });
  return new EditorView({ state });
};

type CapturedChange = {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
};

/**
 * Wrap an EditorView so the next `view.dispatch` call records the change
 * span(s) it would apply. Tests use this to assert the *shape* of the
 * transaction (insert-only, narrow replace) rather than the post-state diff.
 */
const captureNextDispatch = (
  view: EditorView,
): { changes: CapturedChange[] } => {
  const captured: { changes: CapturedChange[] } = { changes: [] };
  // The commands under test only call the `TransactionSpec` overload of
  // `view.dispatch`, so the wrapper narrows to that single overload via a
  // typed alias and forwards calls to the original after recording the
  // change spans. The narrowing assertion is safe because runtime behaviour
  // is identical for the overloads we care about.
  type DispatchSpecsFn = (...specs: TransactionSpec[]) => void;
  const target =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    view as unknown as { dispatch: DispatchSpecsFn };
  const original = target.dispatch.bind(view);
  target.dispatch = (...specs: TransactionSpec[]): void => {
    for (const spec of specs) {
      const changes = spec.changes;
      if (changes !== undefined) {
        const set = ChangeSet.of(changes, view.state.doc.length);
        set.iterChanges((from, to, _fromB, _toB, inserted) => {
          captured.changes.push({ from, to, insert: inserted.toString() });
        });
      }
    }
    original(...specs);
  };
  return captured;
};

describe("commands", () => {
  it("[ic-inline] insertInlineComment wraps the selected source range with critic markup", () => {
    const view = makeView("hello world");
    const id = insertInlineComment(
      view,
      { sourceStart: 6, sourceEnd: 11 },
      "spelling",
      "alice",
    );
    const out = view.state.doc.toString();
    expect(out.startsWith("hello {==world==}{>>id:")).toBe(true);
    expect(out).toContain(`id:${id}`);
    expect(out).toContain("by:@alice");
    expect(out.endsWith(": spelling<<}")).toBe(true);
  });

  it("[ic-block-next] insertBlockComment with target:next inserts marker preceding the line", () => {
    const view = makeView("line1\nline2\nline3");
    const id = insertBlockComment(view, 2, "next", "issue here", "bob");
    const out = view.state.doc.toString();
    expect(out).toMatch(
      /line1\n\{>>block id:[a-z0-9]+ target:next.*<<\}\n\nline2\nline3/,
    );
    expect(out).toContain(`id:${id}`);
  });

  it("[ic-block-prev] insertBlockComment with target:prev inserts after the line", () => {
    const view = makeView("a\nb\nc");
    insertBlockComment(view, 2, "prev", "after", "carol");
    expect(view.state.doc.toString()).toMatch(
      /a\nb\n\n\{>>block id:[a-z0-9]+ target:prev.*: after<<\}\nc/,
    );
  });

  it("[ic-reply] appendThreadReply adds a message segment to the body", () => {
    const view = makeView("x {==y==}{>>id:abc | by:@a 2026-01-01: hi<<} z");
    const ok = appendThreadReply(view, "abc", "thanks", "bob");
    expect(ok).toBe(true);
    const out = view.state.doc.toString();
    expect(out).toContain("by:@a 2026-01-01: hi");
    expect(out).toContain("by:@bob ");
    expect(out).toContain(": thanks");
  });

  it("[ic-reply-missing] appendThreadReply returns false when thread id is absent", () => {
    const view = makeView("plain text");
    expect(appendThreadReply(view, "missing", "x", "alice")).toBe(false);
  });

  it("[ic-resolve] toggleThreadResolved flips the resolved flag", () => {
    const view = makeView("p {==q==}{>>id:abc | by:@a 2026-01-01: hi<<}");
    expect(toggleThreadResolved(view, "abc")).toBe(true);
    expect(view.state.doc.toString()).toContain("resolved:true");
    expect(toggleThreadResolved(view, "abc")).toBe(true);
    expect(view.state.doc.toString()).not.toContain("resolved:true");
  });

  it("[ic-resolve-block] toggleThreadResolved works on block markers too", () => {
    const view = makeView(
      "{>>block id:bk target:next | by:@a 2026-01-01: hi<<}\n\n```\ncode\n```\n",
    );
    expect(toggleThreadResolved(view, "bk")).toBe(true);
    expect(view.state.doc.toString()).toContain("resolved:true");
  });

  it("[ic-resolve-missing] toggleThreadResolved returns false when id absent", () => {
    const view = makeView("plain");
    expect(toggleThreadResolved(view, "abc")).toBe(false);
  });

  it("[ic-skip-malformed] locator skips malformed inline bodies and matches a later valid block", () => {
    const doc =
      "x {==y==}{>>not a body<<} z\n\n{>>block id:bk target:next | by:@a 2026: hi<<}";
    const view = makeView(doc);
    expect(toggleThreadResolved(view, "bk")).toBe(true);
    expect(view.state.doc.toString()).toContain("resolved:true");
  });

  it("[ic-skip-other-id] locator skips inline threads with non-matching ids", () => {
    const view = makeView(
      "{==a==}{>>id:other | by:@a 2026: x<<} {==b==}{>>id:want | by:@a 2026: y<<}",
    );
    expect(appendThreadReply(view, "want", "reply", "bob")).toBe(true);
    expect(view.state.doc.toString()).toMatch(/id:want.*by:@bob.*: reply<<\}/);
  });

  it("[ic-skip-block-other-id] locator skips block threads with non-matching ids", () => {
    const view = makeView(
      "{>>block id:b1 target:next | by:@a 2026: x<<}\n\n{>>block id:b2 target:next | by:@a 2026: y<<}",
    );
    expect(appendThreadReply(view, "b2", "reply", "bob")).toBe(true);
  });

  it("[ic-reply-insert-only] appendThreadReply dispatches an insert-only transaction at the body end", () => {
    const initial = "x {==y==}{>>id:abc | by:@a 2026-01-01: hi<<} z";
    const view = makeView(initial);
    const captured = captureNextDispatch(view);
    expect(appendThreadReply(view, "abc", "thanks", "bob")).toBe(true);
    expect(captured.changes).toHaveLength(1);
    const change = captured.changes[0];
    // Insert-only: from === to, nothing replaced.
    expect(change.from).toBe(change.to);
    // Position must be exactly at the `<<}` boundary, i.e. at the body end.
    expect(initial.slice(change.from, change.from + 3)).toBe("<<}");
    expect(change.insert.startsWith(" | by:@bob ")).toBe(true);
    expect(change.insert.endsWith(": thanks")).toBe(true);
  });

  it("[ic-resolve-absent-insert] toggleThreadResolved (absent → true) inserts after the id token", () => {
    const initial = "p {==q==}{>>id:abc | by:@a 2026-01-01: hi<<}";
    const view = makeView(initial);
    const captured = captureNextDispatch(view);
    expect(toggleThreadResolved(view, "abc")).toBe(true);
    expect(captured.changes).toHaveLength(1);
    const change = captured.changes[0];
    expect(change.from).toBe(change.to);
    expect(change.insert).toBe(" resolved:true");
    // The insert should land immediately after `id:abc`.
    expect(initial.slice(change.from - "id:abc".length, change.from)).toBe(
      "id:abc",
    );
    expect(view.state.doc.toString()).toContain("id:abc resolved:true |");
  });

  it("[ic-resolve-flip] toggleThreadResolved (true → false) replaces only the literal", () => {
    const initial =
      "p {==q==}{>>id:abc resolved:true | by:@a 2026-01-01: hi<<}";
    const view = makeView(initial);
    const captured = captureNextDispatch(view);
    expect(toggleThreadResolved(view, "abc")).toBe(true);
    expect(captured.changes).toHaveLength(1);
    const change = captured.changes[0];
    // The replaced span is exactly the four characters of `true`.
    expect(change.to - change.from).toBe("true".length);
    expect(initial.slice(change.from, change.to)).toBe("true");
    expect(change.insert).toBe("false");
  });

  it("[ic-resolve-flip-false-true] toggleThreadResolved (false → true) replaces only the literal", () => {
    // Covers the case where an explicit `resolved:false` token is present:
    // the toggle must flip just the value, leaving surrounding bytes alone.
    const initial =
      "p {==q==}{>>id:abc resolved:false | by:@a 2026-01-01: hi<<}";
    const view = makeView(initial);
    const captured = captureNextDispatch(view);
    expect(toggleThreadResolved(view, "abc")).toBe(true);
    expect(captured.changes).toHaveLength(1);
    const change = captured.changes[0];
    expect(change.to - change.from).toBe("false".length);
    expect(initial.slice(change.from, change.to)).toBe("false");
    expect(change.insert).toBe("true");
  });

  it("[ic-reply-no-clobber] reply ChangeSpec composes with a concurrent remote insert without overlap", () => {
    // Simulate a remote insert *inside* the body span happening before our
    // local reply lands. Because the reply transaction is a zero-length
    // insert at the closing `<<}`, its byte range cannot overlap the remote
    // edit anywhere inside the body.
    const initial = "x {==y==}{>>id:abc | by:@a 2026-01-01: hi<<} z";
    const view = makeView(initial);
    const captured = captureNextDispatch(view);
    appendThreadReply(view, "abc", "thanks", "bob");
    const local = captured.changes[0];
    // A remote insert at, say, just after `by:@a ` inside the body.
    const remoteFrom = initial.indexOf("by:@a ") + "by:@a ".length;
    const remoteTo = remoteFrom; // pure insert
    // Overlap test: closed-open intervals [from, to) — local is a point, so
    // overlap means remote's range strictly contains it. They must not cross.
    expect(local.from).toBeGreaterThan(remoteTo);
    expect(local.to - local.from).toBe(0);
  });

  it("[ic-newline-roundtrip] insertInlineComment + parse round-trips a body with a real newline", async () => {
    const view = makeView("hello world");
    const id = insertInlineComment(
      view,
      { sourceStart: 6, sourceEnd: 11 },
      "line one\nline two",
      "alice",
    );
    const out = view.state.doc.toString();
    // The wire form must not contain the literal newline inside the body.
    const bodyMatch = out.match(/\{>>([\s\S]*?)<<\}/);
    expect(bodyMatch?.[1]).toContain("line one\\nline two");
    const { parseInlineBody } = await import("../criticmarkup");
    const parsed = parseInlineBody(bodyMatch?.[1] ?? "");
    expect(parsed?.id).toBe(id);
    expect(parsed?.messages[0]?.text).toBe("line one\nline two");
  });

  it("[ic-close-marker-roundtrip] body containing `<<}` round-trips intact", async () => {
    const view = makeView("hello world");
    insertInlineComment(
      view,
      { sourceStart: 6, sourceEnd: 11 },
      "see <<} for syntax",
      "alice",
    );
    const out = view.state.doc.toString();
    const bodyMatch = out.match(/\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/);
    const { parseInlineBody } = await import("../criticmarkup");
    const parsed = parseInlineBody(bodyMatch?.[1] ?? "");
    expect(parsed?.messages[0]?.text).toBe("see <<} for syntax");
  });

  it("[ic-pipe-roundtrip] body containing ` | ` round-trips intact (single message)", async () => {
    const view = makeView("hello world");
    insertInlineComment(
      view,
      { sourceStart: 6, sourceEnd: 11 },
      "this | that | other",
      "alice",
    );
    const out = view.state.doc.toString();
    const bodyMatch = out.match(/\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/);
    const { parseInlineBody } = await import("../criticmarkup");
    const parsed = parseInlineBody(bodyMatch?.[1] ?? "");
    // Without escaping the body would split into 4 segments and parse would fail.
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]?.text).toBe("this | that | other");
  });

  it("[ic-reply-newline-roundtrip] appendThreadReply escapes a newline-containing reply", async () => {
    const view = makeView("x {==y==}{>>id:abc | by:@a 2026-01-01: hi<<} z");
    const ok = appendThreadReply(view, "abc", "first\nsecond", "bob");
    expect(ok).toBe(true);
    const out = view.state.doc.toString();
    expect(out).not.toContain("first\nsecond");
    expect(out).toContain("first\\nsecond");
    const bodyMatch = out.match(/\{>>((?:\\.|[^\\<]|<(?!<\}))*?)<<\}/);
    const { parseInlineBody } = await import("../criticmarkup");
    const parsed = parseInlineBody(bodyMatch?.[1] ?? "");
    expect(parsed?.messages).toHaveLength(2);
    expect(parsed?.messages[1]?.text).toBe("first\nsecond");
  });
});
