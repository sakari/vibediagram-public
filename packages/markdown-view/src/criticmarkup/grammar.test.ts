import { describe, it, expect } from "vitest";
import {
  parseInlineBody,
  parseBlockBody,
  serializeInlineBody,
  serializeBlockBody,
  appendReply,
  setResolved,
  generateId,
  escapeBodyText,
  unescapeBodyText,
  escapeHighlightExact,
  unescapeHighlightExact,
  InvalidBodyError,
} from "./grammar";
import type { InlineThread, BlockThread, Message } from "./grammar";

describe("parseInlineBody", () => {
  it("parses a header-only thread", () => {
    expect(parseInlineBody("id:c3kx4f")).toEqual({
      id: "c3kx4f",
      resolved: false,
      messages: [],
    });
  });

  it("parses thread + thread-ref + resolved", () => {
    const r = parseInlineBody("id:abc thread:xyz resolved:true");
    expect(r).toEqual({
      id: "abc",
      thread: "xyz",
      resolved: true,
      messages: [],
    });
  });

  it("parses messages", () => {
    const body =
      "id:c1 | by:@alice 2026-05-09T10:00Z: hello | by:@bob 2026-05-09T10:05Z: world";
    const parsed = parseInlineBody(body);
    expect(parsed?.messages).toHaveLength(2);
    expect(parsed?.messages[0]).toEqual({
      author: "alice",
      ts: "2026-05-09T10:00Z",
      text: "hello",
    });
  });

  it("accepts resolved:false explicitly", () => {
    expect(parseInlineBody("id:c1 resolved:false")?.resolved).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(parseInlineBody("")).toBeNull();
  });

  it("rejects a missing id", () => {
    expect(parseInlineBody("resolved:true")).toBeNull();
  });

  it("rejects an unknown header key", () => {
    expect(parseInlineBody("id:c1 foo:bar")).toBeNull();
  });

  it("rejects a duplicate header key", () => {
    expect(parseInlineBody("id:c1 id:c2")).toBeNull();
  });

  it("rejects a non-bool resolved", () => {
    expect(parseInlineBody("id:c1 resolved:maybe")).toBeNull();
  });

  it("rejects a malformed message", () => {
    expect(parseInlineBody("id:c1 | not-a-message")).toBeNull();
  });

  it("rejects a malformed handle", () => {
    expect(parseInlineBody("id:c1 | by:@bad!handle 2026: hi")).toBeNull();
  });

  it("rejects a leading bare keyword in inline", () => {
    expect(parseInlineBody("block id:c1")).toBeNull();
  });

  it("rejects malformed id chars", () => {
    expect(parseInlineBody("id:has-dash")).toBeNull();
  });

  it("rejects malformed thread chars", () => {
    expect(parseInlineBody("id:c1 thread:bad-id")).toBeNull();
  });

  it("rejects missing colon in token", () => {
    expect(parseInlineBody("id:c1 stray")).toBeNull();
  });

  it("rejects empty key", () => {
    expect(parseInlineBody(":value")).toBeNull();
  });

  it("rejects empty value", () => {
    expect(parseInlineBody("id:")).toBeNull();
  });

  it("parses message ending with empty text", () => {
    const body = "id:c1 | by:@a 2026-05-09:";
    const parsed = parseInlineBody(body);
    expect(parsed?.messages[0]).toEqual({
      author: "a",
      ts: "2026-05-09",
      text: "",
    });
  });

  it("rejects message missing space before colon-text", () => {
    expect(parseInlineBody("id:c1 | by:@a")).toBeNull();
  });

  it("rejects message with empty timestamp", () => {
    expect(parseInlineBody("id:c1 | by:@a : hi")).toBeNull();
  });

  it("rejects message with empty timestamp before bare colon", () => {
    expect(parseInlineBody("id:c1 | by:@a:")).toBeNull();
  });
});

describe("parseBlockBody", () => {
  it("parses a block header with target:next", () => {
    expect(parseBlockBody("block id:c4 target:next")).toEqual({
      id: "c4",
      resolved: false,
      target: "next",
      messages: [],
    });
  });

  it("parses block with thread + resolved + messages", () => {
    const parsed = parseBlockBody(
      "block id:c4 target:prev thread:t1 resolved:true | by:@a 2026: hi",
    );
    expect(parsed).toMatchObject({
      id: "c4",
      thread: "t1",
      resolved: true,
      target: "prev",
    });
    expect(parsed?.messages).toHaveLength(1);
  });

  it("rejects missing target", () => {
    expect(parseBlockBody("block id:c4")).toBeNull();
  });

  it("rejects bad target value", () => {
    expect(parseBlockBody("block id:c4 target:sideways")).toBeNull();
  });

  it("rejects missing 'block' leading keyword", () => {
    expect(parseBlockBody("id:c4 target:next")).toBeNull();
  });

  it("rejects unknown key in block", () => {
    expect(parseBlockBody("block id:c4 target:next foo:bar")).toBeNull();
  });

  it("rejects bad id in block", () => {
    expect(parseBlockBody("block id:- target:next")).toBeNull();
  });

  it("rejects bad thread in block", () => {
    expect(parseBlockBody("block id:c1 target:next thread:-")).toBeNull();
  });

  it("rejects bad resolved in block", () => {
    expect(parseBlockBody("block id:c1 target:next resolved:nope")).toBeNull();
  });

  it("rejects bad message in block", () => {
    expect(parseBlockBody("block id:c1 target:next | nope")).toBeNull();
  });

  it("rejects empty body", () => {
    expect(parseBlockBody("")).toBeNull();
  });
});

describe("serialize round-trip", () => {
  const roundTripInline = (t: InlineThread): void => {
    const s = serializeInlineBody(t);
    expect(parseInlineBody(s)).toEqual(t);
  };
  const roundTripBlock = (t: BlockThread): void => {
    const s = serializeBlockBody(t);
    expect(parseBlockBody(s)).toEqual(t);
  };

  it("round-trips inline minimal", () => {
    roundTripInline({ id: "c3kx4f", resolved: false, messages: [] });
  });

  it("round-trips inline with thread + resolved", () => {
    roundTripInline({
      id: "c1",
      thread: "t1",
      resolved: true,
      messages: [],
    });
  });

  it("round-trips inline with messages", () => {
    roundTripInline({
      id: "c1",
      resolved: false,
      messages: [
        { author: "alice", ts: "2026-05-09T10:00Z", text: "hello" },
        { author: "bob", ts: "2026-05-09T10:05Z", text: "world" },
      ],
    });
  });

  it("round-trips block with all fields", () => {
    roundTripBlock({
      id: "c4",
      thread: "t1",
      resolved: true,
      target: "next",
      messages: [{ author: "x", ts: "2026", text: "y" }],
    });
  });

  it("round-trips block target:prev", () => {
    roundTripBlock({
      id: "c5",
      resolved: false,
      target: "prev",
      messages: [],
    });
  });

  it("does not emit resolved:false", () => {
    expect(
      serializeInlineBody({ id: "c1", resolved: false, messages: [] }),
    ).toBe("id:c1");
  });

  it("emits resolved:true", () => {
    expect(
      serializeInlineBody({ id: "c1", resolved: true, messages: [] }),
    ).toContain("resolved:true");
  });
});

describe("appendReply", () => {
  it("appends to inline", () => {
    const msg: Message = { author: "a", ts: "2026", text: "hi" };
    const next = appendReply("id:c1", msg);
    expect(parseInlineBody(next)?.messages).toHaveLength(1);
  });

  it("appends to block", () => {
    const msg: Message = { author: "a", ts: "2026", text: "hi" };
    const next = appendReply("block id:c1 target:next", msg);
    expect(parseBlockBody(next)?.messages).toHaveLength(1);
  });

  it("throws on malformed body", () => {
    expect(() =>
      appendReply("garbage", { author: "a", ts: "2026", text: "hi" }),
    ).toThrow(InvalidBodyError);
  });
});

describe("setResolved", () => {
  it("flips resolved on inline", () => {
    const next = setResolved("id:c1", true);
    expect(parseInlineBody(next)?.resolved).toBe(true);
  });

  it("flips resolved on block", () => {
    const next = setResolved("block id:c1 target:next", true);
    expect(parseBlockBody(next)?.resolved).toBe(true);
  });

  it("flips back to false", () => {
    const next = setResolved("id:c1 resolved:true", false);
    expect(parseInlineBody(next)?.resolved).toBe(false);
  });

  it("throws on malformed", () => {
    expect(() => setResolved("nope", true)).toThrow(InvalidBodyError);
  });
});

interface ConsoleErrorSpy {
  readonly calls: unknown[][];
  readonly restore: () => void;
}

const spyConsoleError = (): ConsoleErrorSpy => {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
};

describe("escapeBodyText / unescapeBodyText", () => {
  const ROUND_TRIP_BODIES = [
    "plain text",
    "with a newline\nin the middle",
    "ends with newline\n",
    "two | three (segment-looking but not separator due to no escape needed by itself)",
    "real separator: a | b but used as text",
    "contains <<} close marker mid-text",
    "double <<} <<} close markers",
    "trailing backslash \\",
    "backslash + n: \\n is not a real newline",
    "all together: line1\nline2 | piped \\ <<} done",
    "",
  ];

  for (const body of ROUND_TRIP_BODIES) {
    it(`round-trips ${JSON.stringify(body)}`, () => {
      expect(unescapeBodyText(escapeBodyText(body))).toBe(body);
    });
  }

  it("escapes a backslash to two backslashes", () => {
    expect(escapeBodyText("\\")).toBe("\\\\");
  });

  it("escapes a newline to backslash-n", () => {
    expect(escapeBodyText("\n")).toBe("\\n");
  });

  it("escapes only `<` of `<<}` not bare `<`", () => {
    expect(escapeBodyText("a < b")).toBe("a < b");
    expect(escapeBodyText("a <<} b")).toBe("a \\<<} b");
  });

  it("escapes ` | ` to ` \\| `", () => {
    expect(escapeBodyText("a | b")).toBe("a \\| b");
  });

  it("does not escape an isolated `|`", () => {
    expect(escapeBodyText("a|b")).toBe("a|b");
  });

  it("preserves an unknown backslash escape on unescape", () => {
    expect(unescapeBodyText("\\x")).toBe("\\x");
  });

  it("preserves a trailing lone backslash on unescape", () => {
    expect(unescapeBodyText("ends with \\")).toBe("ends with \\");
  });
});

describe("escapeHighlightExact / unescapeHighlightExact", () => {
  const ROUND_TRIP_EXACTS = [
    "plain",
    "with backslash \\ in middle",
    "trailing backslash \\",
    "contains ==} close marker mid-text",
    "double ==} ==} close markers",
    "less than < and pipe | are fine",
    "newline\nstays as is",
    "",
  ];
  for (const exact of ROUND_TRIP_EXACTS) {
    it(`round-trips ${JSON.stringify(exact)}`, () => {
      expect(unescapeHighlightExact(escapeHighlightExact(exact))).toBe(exact);
    });
  }

  it("escapes only `=` of `==}` not bare `=`", () => {
    expect(escapeHighlightExact("a = b")).toBe("a = b");
    expect(escapeHighlightExact("a ==} b")).toBe("a \\==} b");
  });

  it("escapes a backslash to two backslashes", () => {
    expect(escapeHighlightExact("\\")).toBe("\\\\");
  });

  it("preserves an unknown backslash escape on unescape", () => {
    expect(unescapeHighlightExact("\\x")).toBe("\\x");
  });

  it("preserves a trailing lone backslash on unescape", () => {
    expect(unescapeHighlightExact("ends with \\")).toBe("ends with \\");
  });
});

describe("body parsing with escaped characters", () => {
  it("parses a message body with a real newline", () => {
    const body = "id:c1 | by:@a 2026: line one\\nline two";
    const parsed = parseInlineBody(body);
    expect(parsed?.messages[0]?.text).toBe("line one\nline two");
  });

  it("parses a message body with an escaped pipe separator", () => {
    const body = "id:c1 | by:@a 2026: left \\| right";
    const parsed = parseInlineBody(body);
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]?.text).toBe("left | right");
  });

  it("parses a message body with an escaped close marker", () => {
    const body = "id:c1 | by:@a 2026: see \\<<} for syntax";
    const parsed = parseInlineBody(body);
    expect(parsed?.messages[0]?.text).toBe("see <<} for syntax");
  });

  it("round-trips a message containing all escape-needing chars", () => {
    const thread = {
      id: "c1",
      resolved: false,
      messages: [
        {
          author: "alice",
          ts: "2026",
          text: "line1\nline2 | piped \\ <<} end",
        },
      ],
    };
    const serialized = serializeInlineBody(thread);
    expect(parseInlineBody(serialized)).toEqual(thread);
  });

  it("splitSegments splits two segments separated by ` | ` but keeps escaped pipes", () => {
    // Indirect coverage of splitSegments via parseInlineBody.
    const thread = {
      id: "c1",
      resolved: false,
      messages: [
        { author: "a", ts: "2026", text: "one | still one" },
        { author: "b", ts: "2026", text: "two" },
      ],
    };
    const serialized = serializeInlineBody(thread);
    const parsed = parseInlineBody(serialized);
    expect(parsed?.messages).toHaveLength(2);
    expect(parsed?.messages[0]?.text).toBe("one | still one");
    expect(parsed?.messages[1]?.text).toBe("two");
  });
});

describe("generateId", () => {
  it("returns a string of length 6", () => {
    const id = generateId();
    expect(id).toHaveLength(6);
    expect(/^[0-9a-z]+$/.test(id)).toBe(true);
  });

  it("returns different ids across calls (probabilistic)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i += 1) set.add(generateId());
    expect(set.size).toBeGreaterThan(95);
  });

  it("uses the Math.random fallback when crypto is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const errSpy = spyConsoleError();
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const id = generateId();
      expect(id).toHaveLength(6);
      expect(errSpy.calls.length).toBeGreaterThan(0);
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(globalThis, "crypto", descriptor);
      }
      errSpy.restore();
    }
  });
});
