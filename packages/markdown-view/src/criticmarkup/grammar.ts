/**
 * Thread-body micro-format used inside CriticMarkup `{>>...<<}` markers.
 *
 * The format is our extension on top of CriticMarkup; it must round-trip
 * losslessly so agents that read and rewrite `FileEntry.content` see a
 * stable representation. See plans/markdown-comments/plan.md for context.
 */

export type Message = {
  readonly author: string;
  readonly ts: string;
  readonly text: string;
};

export type InlineThread = {
  readonly id: string;
  readonly thread?: string;
  readonly resolved: boolean;
  readonly messages: readonly Message[];
};

export type BlockTarget = "next" | "prev";

export type BlockThread = InlineThread & {
  readonly target: BlockTarget;
};

const ID_PATTERN = /^[A-Za-z0-9]+$/;
const HANDLE_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Encode a logical message text for the wire format. The encoded form must
 * survive embedding inside a `{>>...<<}` body that itself uses ` | ` as a
 * segment separator. Escapes are minimal so common-case bodies stay readable.
 *
 * The escapes only need to survive the source-level CriticMarkup preprocessor
 * (see `preprocess.ts`). They do NOT need to survive `remark-parse`, because
 * the preprocessor strips them before the markdown parser ever sees the source.
 *
 * Order of escapes matters — we escape `\` first so the escape character we
 * introduce in subsequent steps cannot collide with literal user input.
 */
export const escapeBodyText = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\") {
      out += "\\\\";
      continue;
    }
    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    // Escape just enough of `<<}` to break the marker close: prefix the first
    // `<` of any `<<}` run with a backslash. The outer regex then ignores
    // `\<<}` and only stops on an unescaped `<<}`.
    if (ch === "<" && s[i + 1] === "<" && s[i + 2] === "}") {
      out += "\\<";
      continue;
    }
    // Escape `|` whenever it sits between two spaces, because that exact
    // pattern is the segment separator. The space chars themselves do not
    // need escaping.
    if (ch === "|" && s[i - 1] === " " && s[i + 1] === " ") {
      out += "\\|";
      continue;
    }
    out += ch;
  }
  return out;
};

/**
 * Reverse {@link escapeBodyText}. Single-pass scan: `\\`, `\n`, `\<`, `\|` map
 * back to their literal forms. Any other backslash escape is preserved
 * verbatim (the backslash and the following char both pass through).
 */
export const unescapeBodyText = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "\\") {
        out += "\\";
        i += 1;
        continue;
      }
      if (next === "n") {
        out += "\n";
        i += 1;
        continue;
      }
      if (next === "<") {
        out += "<";
        i += 1;
        continue;
      }
      if (next === "|") {
        out += "|";
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
};

/**
 * Split a body on the ` | ` segment separator while respecting backslash
 * escapes. A pipe preceded by an unescaped backslash (i.e. ` \| `) is part of
 * the surrounding segment, not a separator.
 */
const splitSegments = (body: string): string[] => {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  while (i < body.length) {
    // Treat `\X` as a two-character literal so we never look at `X` as the
    // start of a separator. Critically this handles the ` \| ` case.
    if (body[i] === "\\" && i + 1 < body.length) {
      current += body[i] + body[i + 1];
      i += 2;
      continue;
    }
    if (body[i] === " " && body[i + 1] === "|" && body[i + 2] === " ") {
      segments.push(current.trim());
      current = "";
      i += 3;
      continue;
    }
    current += body[i];
    i += 1;
  }
  segments.push(current.trim());
  return segments;
};

const parseHeaderTokens = (
  header: string,
): {
  tokens: Map<string, string>;
  leading?: string;
} | null => {
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(/\s+/);
  let leading: string | undefined;
  let start = 0;
  // trimmed is non-empty so parts always has at least one element.
  const first = parts[0];
  if (!first.includes(":")) {
    leading = first;
    start = 1;
  }

  const tokens = new Map<string, string>();
  for (let i = start; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    const colon = part.indexOf(":");
    if (colon <= 0) return null;
    const key = part.slice(0, colon);
    const value = part.slice(colon + 1);
    if (key.length === 0 || value.length === 0) return null;
    if (tokens.has(key)) return null;
    tokens.set(key, value);
  }
  return leading === undefined ? { tokens } : { tokens, leading };
};

const parseResolved = (raw: string | undefined): boolean | null => {
  if (raw === undefined) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
};

const parseMessage = (segment: string): Message | null => {
  if (!segment.startsWith("by:@")) return null;
  const afterBy = segment.slice(4);
  const firstSpace = afterBy.indexOf(" ");
  if (firstSpace <= 0) return null;
  const author = afterBy.slice(0, firstSpace);
  if (!HANDLE_PATTERN.test(author)) return null;
  const rest = afterBy.slice(firstSpace + 1);
  const colon = rest.indexOf(": ");
  if (colon <= 0) {
    if (rest.endsWith(":")) {
      const ts = rest.slice(0, rest.length - 1);
      if (ts.length === 0) return null;
      return { author, ts, text: "" };
    }
    return null;
  }
  const ts = rest.slice(0, colon);
  const rawText = rest.slice(colon + 2);
  if (ts.length === 0) return null;
  return { author, ts, text: unescapeBodyText(rawText) };
};

const parseInlineHeader = (
  header: string,
): { id: string; thread?: string; resolved: boolean } | null => {
  const parsed = parseHeaderTokens(header);
  if (parsed === null) return null;
  if (parsed.leading !== undefined) return null;
  const { tokens } = parsed;
  const id = tokens.get("id");
  if (id === undefined || !ID_PATTERN.test(id)) return null;
  const thread = tokens.get("thread");
  if (thread !== undefined && !ID_PATTERN.test(thread)) return null;
  const resolved = parseResolved(tokens.get("resolved"));
  if (resolved === null) return null;
  for (const key of tokens.keys()) {
    if (key !== "id" && key !== "thread" && key !== "resolved") return null;
  }
  const result: { id: string; thread?: string; resolved: boolean } = {
    id,
    resolved,
  };
  if (thread !== undefined) result.thread = thread;
  return result;
};

const BLOCK_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "thread",
  "resolved",
  "target",
]);

const hasOnlyAllowedKeys = (
  tokens: Map<string, string>,
  allowed: ReadonlySet<string>,
): boolean => {
  for (const key of tokens.keys()) {
    if (!allowed.has(key)) return false;
  }
  return true;
};

const parseBlockHeader = (
  header: string,
): {
  id: string;
  thread?: string;
  resolved: boolean;
  target: BlockTarget;
} | null => {
  const parsed = parseHeaderTokens(header);
  if (parsed === null) return null;
  if (parsed.leading !== "block") return null;
  const { tokens } = parsed;
  if (!hasOnlyAllowedKeys(tokens, BLOCK_ALLOWED_KEYS)) return null;
  const id = tokens.get("id");
  if (id === undefined || !ID_PATTERN.test(id)) return null;
  const targetRaw = tokens.get("target");
  if (targetRaw !== "next" && targetRaw !== "prev") return null;
  const thread = tokens.get("thread");
  if (thread !== undefined && !ID_PATTERN.test(thread)) return null;
  const resolved = parseResolved(tokens.get("resolved"));
  if (resolved === null) return null;
  const result: {
    id: string;
    thread?: string;
    resolved: boolean;
    target: BlockTarget;
  } = { id, resolved, target: targetRaw };
  if (thread !== undefined) result.thread = thread;
  return result;
};

const parseMessages = (segments: readonly string[]): Message[] | null => {
  const messages: Message[] = [];
  for (const segment of segments) {
    const msg = parseMessage(segment);
    if (msg === null) return null;
    messages.push(msg);
  }
  return messages;
};

export const parseInlineBody = (body: string): InlineThread | null => {
  const segments = splitSegments(body);
  // splitSegments always returns at least one element (String.split contract).
  const headerSegment = segments[0];
  const header = parseInlineHeader(headerSegment);
  if (header === null) return null;
  const messages = parseMessages(segments.slice(1));
  if (messages === null) return null;
  const out: InlineThread =
    header.thread === undefined
      ? { id: header.id, resolved: header.resolved, messages }
      : {
          id: header.id,
          thread: header.thread,
          resolved: header.resolved,
          messages,
        };
  return out;
};

export const parseBlockBody = (body: string): BlockThread | null => {
  const segments = splitSegments(body);
  // splitSegments always returns at least one element (String.split contract).
  const headerSegment = segments[0];
  const header = parseBlockHeader(headerSegment);
  if (header === null) return null;
  const messages = parseMessages(segments.slice(1));
  if (messages === null) return null;
  const base: InlineThread =
    header.thread === undefined
      ? { id: header.id, resolved: header.resolved, messages }
      : {
          id: header.id,
          thread: header.thread,
          resolved: header.resolved,
          messages,
        };
  return { ...base, target: header.target };
};

const serializeHeaderInline = (thread: InlineThread): string => {
  const parts = [`id:${thread.id}`];
  if (thread.thread !== undefined) parts.push(`thread:${thread.thread}`);
  if (thread.resolved) parts.push("resolved:true");
  return parts.join(" ");
};

const serializeHeaderBlock = (thread: BlockThread): string => {
  const parts = [`block id:${thread.id}`, `target:${thread.target}`];
  if (thread.thread !== undefined) parts.push(`thread:${thread.thread}`);
  if (thread.resolved) parts.push("resolved:true");
  return parts.join(" ");
};

const serializeMessage = (msg: Message): string =>
  `by:@${msg.author} ${msg.ts}: ${escapeBodyText(msg.text)}`;

/**
 * Encode the highlighted source range (`exact`) for the wire form. The exact
 * value sits inside `{==…==}` and must survive the source-level preprocessor.
 *
 * Two kinds of byte sequence break that envelope: the literal close marker
 * `==}` (which terminates the highlight slot early) and a literal `\` (which
 * could form an escape pair with the following byte and shadow a real
 * character). Every other byte — including `<`, `|`, newlines, `>` — is safe
 * inside `{==…==}` and passes through verbatim.
 */
export const escapeHighlightExact = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\") {
      out += "\\\\";
      continue;
    }
    if (ch === "=" && s[i + 1] === "=" && s[i + 2] === "}") {
      // Break the close-marker run by escaping the first `=` of `==}`.
      out += "\\=";
      continue;
    }
    out += ch;
  }
  return out;
};

/**
 * Reverse {@link escapeHighlightExact}. Single-pass scan: `\\` -> `\`,
 * `\=` -> `=`. Any other backslash escape is preserved verbatim.
 */
export const unescapeHighlightExact = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "\\") {
        out += "\\";
        i += 1;
        continue;
      }
      if (next === "=") {
        out += "=";
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
};

const joinSegments = (header: string, messages: readonly Message[]): string => {
  if (messages.length === 0) return header;
  return `${header} | ${messages.map(serializeMessage).join(" | ")}`;
};

export const serializeInlineBody = (thread: InlineThread): string =>
  joinSegments(serializeHeaderInline(thread), thread.messages);

export const serializeBlockBody = (thread: BlockThread): string =>
  joinSegments(serializeHeaderBlock(thread), thread.messages);

const reserializeWithMessages = (
  body: string,
  transform: (messages: readonly Message[]) => readonly Message[],
  setResolvedFlag?: boolean,
): string => {
  const inline = parseInlineBody(body);
  if (inline !== null) {
    const next: InlineThread = {
      ...inline,
      resolved: setResolvedFlag ?? inline.resolved,
      messages: transform(inline.messages),
    };
    return serializeInlineBody(next);
  }
  const block = parseBlockBody(body);
  if (block !== null) {
    const next: BlockThread = {
      ...block,
      resolved: setResolvedFlag ?? block.resolved,
      messages: transform(block.messages),
    };
    return serializeBlockBody(next);
  }
  throw new InvalidBodyError(body);
};

export class InvalidBodyError extends Error {
  constructor(body: string) {
    super(`Invalid CriticMarkup thread body: ${body}`);
    this.name = "InvalidBodyError";
  }
}

export const appendReply = (body: string, msg: Message): string =>
  reserializeWithMessages(body, (messages) => [...messages, msg]);

export const setResolved = (body: string, resolved: boolean): string =>
  reserializeWithMessages(body, (messages) => messages, resolved);

const ID_ALPHABET = "0123456789abcdefghijkmnpqrstvwxyz";

export const generateId = (): string => {
  // 6 base32 chars = 30 bits of entropy; collisions are rare per-document
  // and the repair pass fixes any that do occur.
  const bytes = new Uint8Array(6);
  cryptoRandom(bytes);
  let out = "";
  for (const b of bytes) {
    out += ID_ALPHABET[b % ID_ALPHABET.length];
  }
  return out;
};

const cryptoRandom = (bytes: Uint8Array): void => {
  const g = globalThis as {
    crypto?: { getRandomValues?: (a: Uint8Array) => void };
  };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
    return;
  }
  // Math.random fallback for exotic environments. We log because relying on
  // Math.random for ids is a real correctness issue worth surfacing.
  console.error(
    "generateId: crypto.getRandomValues unavailable, falling back to Math.random",
  );
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
};
