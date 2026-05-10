# Markdown comments

`.md` files in your project can carry inline comments and threaded
discussion using a small extension to
[CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit).
Use them to leave marginalia, ask questions, or coordinate with an
agent — comments live as plain text in the markdown source so they
travel with the file and survive any tool that can read markdown.

## Quick start in the preview pane

1. Open a `.md` file. The right pane shows the rendered preview.
2. Select a span of text. A "Comment" button appears in the upper
   right of the preview.
3. Click the button, type a comment, hit Submit. A bubble appears in
   the right margin and the source gains a `{==span==}{>>...<<}`
   marker.
4. Click any bubble to expand the thread. Reply or Resolve from there.

To comment on a code block or Mermaid diagram, hover over it in the
preview and use the same Comment affordance — the source gains a
`{>>block ...<<}` marker on the line above the fence.

## Inline form

Highlight a span and pair it with a thread:

```
{==span==}{>>id:cN | by:@handle ISO8601: text<<}
```

The thread body starts with a header (`id:cN` first; optional
`thread:t-foo`; optional `resolved:true` or `resolved:false`, default
`false`), followed by `|` separated messages of the form
`by:@handle <iso>: text`. Every additional `|` segment is one more
reply.

## Block form

Place a block marker on a line of its own immediately adjacent to the
targeted fenced code block, Mermaid diagram, heading, or paragraph:

```
{>>block id:cN target:next|prev | by:@handle <iso>: text<<}
```

`target:next` attaches to the following block, `target:prev` to the
previous. The body grammar matches the inline form.

At most one block-comment thread is permitted per block. Clicking the
hover affordance on a block that already has a thread expands that
existing thread for replies instead of starting a new one.

## Worked example (2-reply thread)

```
The cache is read-through {==and write-back==}{>>id:c4 resolved:false | by:@alice 2026-05-09T10:00:00Z: should this be write-through? | by:@bob 2026-05-09T11:30:00Z: agreed, safer for the failover path | by:@alice 2026-05-09T12:00:00Z: switching it<<}.
```

## Rules

- Markers must not contain newlines. A `{==…==}` or `{>>…<<}` that
  spans a line break is treated as plain text and passes through
  unchanged.
- Malformed markers (bad header, missing `id:`, unknown `target:`
  value, etc.) also pass through as literal text — the renderer never
  throws on a syntactically broken comment.
- IDs (`cN`) must be unique within the file.
- A thread body must always include the `|` separator (with a space
  on each side) between the header and the first message, even when
  there is only one message.
- Editing a marker through the preview UI is safer than typing the
  syntax by hand — the UI uses a parser and rounds-trips losslessly.
- The highlighted text inside `{==…==}` is rendered as plain text in
  the preview. Markdown formatting (bold, italics, links, etc.)
  inside a highlighted span is not preserved in the rendered view —
  the surrounding text still renders normally. This is a v1
  limitation of the source-level marker preprocessor.

## Stale handling

If you delete the highlighted text or the entire `{==...==}{>>...<<}`
marker from the source, the bubble disappears immediately. There is
no separate "orphan" state — comments are anchored by literal source
position, so editing the source is the only way they go away.

## For agents

LLM agents reading or rewriting these files should use the parser in
`@diagram/markdown-view`'s `criticmarkup` module rather than
hand-editing thread bodies. The exported helpers are:

- `parseInlineBody`, `parseBlockBody` — body string → structured
  thread
- `serializeInlineBody`, `serializeBlockBody` — structured thread →
  body string
- `appendReply`, `setResolved` — high-level edits on a body string
- `generateId` — mint a new unique id
- `repairCriticMarkup` — best-effort cleanup for hand-written markers

Agents should self-identify with a stable handle (e.g. `@claude`) so
human reviewers can distinguish their replies from human ones.
