import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  escapeBodyText,
  unescapeBodyText,
  escapeHighlightExact,
  unescapeHighlightExact,
  parseInlineBody,
  parseBlockBody,
  serializeInlineBody,
  serializeBlockBody,
  type InlineThread,
  type BlockThread,
  type Message,
} from "./grammar";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

const arbId = fc.stringMatching(/^[a-z0-9]{1,6}$/);
const arbHandle = fc.stringMatching(/^[A-Za-z0-9_.-]{1,12}$/);
const arbTs = fc
  .integer({ min: 1, max: 9999 })
  .map((n) => `2026-${String((n % 12) + 1).padStart(2, "0")}-01`);
// The grammar splitSegments trims segments, which means leading/trailing
// whitespace (including escaped newlines that decode back to "\n") is lost
// after a round-trip. Filter such arbitraries out so the property tests
// exercise lossless cases only.
const arbBodyText = fc.string({
  unit: "grapheme",
  minLength: 0,
  maxLength: 80,
});
// The grammar's `splitSegments` trims each segment, so leading/trailing
// whitespace inside a message text is lost on a parse round-trip. Filter
// those cases out so the message round-trip property exercises lossless
// inputs only — escape/unescape itself is tested with `arbBodyText`.
const arbMessageText = arbBodyText.filter((s) => s === s.trim());
const arbMessage: fc.Arbitrary<Message> = fc.record({
  author: arbHandle,
  ts: arbTs,
  text: arbMessageText,
});
const arbInline: fc.Arbitrary<InlineThread> = fc
  .record({
    id: arbId,
    resolved: fc.boolean(),
    messages: fc.array(arbMessage, { maxLength: 4 }),
  })
  .filter((t) => /^[a-z0-9]+$/.test(t.id));
const arbBlock: fc.Arbitrary<BlockThread> = fc
  .record({
    id: arbId,
    resolved: fc.boolean(),
    target: fc.constantFrom<"next" | "prev">("next", "prev"),
    messages: fc.array(arbMessage, { maxLength: 4 }),
  })
  .filter((t) => /^[a-z0-9]+$/.test(t.id));

// Highlight exact text. Targeted bytes: `==}`, `<<}`, `\`, `|`, `{`, `}`, `>`,
// newlines, tabs. We mix raw fullUnicode chars with these to maximise the
// probability that the regex sees adversarial inputs.
const arbAdversarialChars = fc.constantFrom(
  "==}",
  "<<}",
  "\\",
  "|",
  "{",
  "}",
  ">",
  "\n",
  "\t",
  " | ",
);
const arbExact = fc
  .array(
    fc.oneof(
      fc.string({ unit: "grapheme", maxLength: 4 }),
      arbAdversarialChars,
    ),
  )
  .map((parts) => parts.join(""))
  .map((s) => s.slice(0, 80));

describe("property: body text escape round-trip", () => {
  it("unescapeBodyText(escapeBodyText(text)) === text", () => {
    fc.assert(
      fc.property(arbBodyText, (text) => {
        return unescapeBodyText(escapeBodyText(text)) === text;
      }),
      { numRuns: 200 },
    );
  });

  it("escaped body never contains the close marker `<<}` unescaped", () => {
    fc.assert(
      fc.property(arbBodyText, (text) => {
        const escaped = escapeBodyText(text);
        // Any `<<}` inside the encoded form must be preceded by a backslash so
        // the preprocessor scanner never confuses it for an end of body.
        for (let i = 0; i + 2 < escaped.length; i += 1) {
          if (
            escaped[i] === "<" &&
            escaped[i + 1] === "<" &&
            escaped[i + 2] === "}"
          ) {
            if (i === 0 || escaped[i - 1] !== "\\") return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("escaped body never contains an unescaped ` | ` separator", () => {
    fc.assert(
      fc.property(arbBodyText, (text) => {
        const escaped = escapeBodyText(text);
        for (let i = 1; i + 1 < escaped.length; i += 1) {
          if (
            escaped[i] === "|" &&
            escaped[i - 1] === " " &&
            escaped[i + 1] === " "
          ) {
            // Must be preceded by a backslash (so the form is `\| `).
            if (i < 2 || escaped[i - 2] !== "\\") return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

describe("property: highlight exact escape round-trip", () => {
  it("unescapeHighlightExact(escapeHighlightExact(s)) === s", () => {
    fc.assert(
      fc.property(arbExact, (s) => {
        return unescapeHighlightExact(escapeHighlightExact(s)) === s;
      }),
      { numRuns: 200 },
    );
  });

  it("escaped exact never contains an unescaped `==}`", () => {
    fc.assert(
      fc.property(arbExact, (s) => {
        const escaped = escapeHighlightExact(s);
        for (let i = 0; i + 2 < escaped.length; i += 1) {
          if (
            escaped[i] === "=" &&
            escaped[i + 1] === "=" &&
            escaped[i + 2] === "}"
          ) {
            if (i === 0 || escaped[i - 1] !== "\\") return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

describe("property: thread serialize round-trip", () => {
  it("parseInlineBody(serializeInlineBody(t)) === t for arbitrary InlineThread", () => {
    fc.assert(
      fc.property(arbInline, (t) => {
        const s = serializeInlineBody(t);
        const parsed = parseInlineBody(s);
        expect(parsed).toEqual(t);
      }),
      { numRuns: 200 },
    );
  });

  it("parseBlockBody(serializeBlockBody(t)) === t for arbitrary BlockThread", () => {
    fc.assert(
      fc.property(arbBlock, (t) => {
        const s = serializeBlockBody(t);
        const parsed = parseBlockBody(s);
        expect(parsed).toEqual(t);
      }),
      { numRuns: 200 },
    );
  });
});

// Sanity-check that the arbitrary id alphabet matches what the grammar
// accepts; otherwise the property tests above filter to empty.
for (const c of ID_CHARS) {
  if (!/^[A-Za-z0-9]+$/.test(c)) {
    throw new Error(`invalid id alphabet char ${c}`);
  }
}
