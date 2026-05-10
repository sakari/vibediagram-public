/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { scanThreads } from "./useThreads";

describe("scanThreads", () => {
  it("[ut-inline] picks up an inline highlight anchor and joins thread metadata", () => {
    const root = document.createElement("div");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    mark.dataset.threadId = "abc";
    mark.dataset.critic = "highlight";
    mark.dataset.resolved = "false";
    mark.textContent = "world";
    root.appendChild(mark);
    document.body.appendChild(root);
    const source = "hello {==world==}{>>id:abc | by:@a 2026-01-01: hi<<}";
    const out = scanThreads(root, source);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "abc",
      kind: "inline",
      thread: { id: "abc", resolved: false },
    });
  });

  it("[ut-block] picks up a block sentinel anchor", () => {
    const root = document.createElement("div");
    const div = document.createElement("div");
    div.className = "vd-block-comment";
    div.dataset.threadId = "blk";
    div.dataset.target = "next";
    div.dataset.resolved = "false";
    root.appendChild(div);
    document.body.appendChild(root);
    const source = "{>>block id:blk target:next | by:@a 2026: x<<}";
    const out = scanThreads(root, source);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("block");
    expect(out[0].id).toBe("blk");
  });

  it("[ut-mixed] returns both inline and block markers from the same root", () => {
    const root = document.createElement("div");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    mark.dataset.threadId = "i1";
    mark.dataset.critic = "highlight";
    const blk = document.createElement("div");
    blk.className = "vd-block-comment";
    blk.dataset.threadId = "b1";
    blk.dataset.target = "prev";
    root.append(mark, blk);
    document.body.appendChild(root);
    const source =
      "x {==y==}{>>id:i1 | by:@a 2026: hi<<}\n\n{>>block id:b1 target:prev | by:@b 2026: yo<<}";
    const out = scanThreads(root, source);
    expect(out.map((m) => m.id).sort()).toEqual(["b1", "i1"]);
  });

  it("[ut-malformed] skips bodies that fail to parse", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    // Both highlights and block patterns appear but only the second of each
    // parses, so indexing should silently skip the malformed entries.
    const source =
      "{==a==}{>>nope<<}\n\nx {==b==}{>>id:i1 | by:@a 2026: y<<}\n\n{>>nope<<}\n\n{>>block id:b1 target:next | by:@a 2026: z<<}";
    expect(scanThreads(root, source)).toEqual([]);
  });

  it("[ut-block-anchor-prev] resolves block marker anchorEl to the previous sibling", () => {
    // The block marker div is hidden (display:none), so its bounding rect is
    // zero. The bubble must position against the actual targeted block.
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.textContent = "code";
    const marker = document.createElement("div");
    marker.className = "vd-block-comment";
    marker.dataset.threadId = "cX";
    marker.dataset.target = "prev";
    marker.style.display = "none";
    root.append(pre, marker);
    document.body.appendChild(root);
    const source = "{>>block id:cX target:prev | by:@a 2026: hi<<}";
    const out = scanThreads(root, source);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("block");
    expect(out[0].anchorEl).toBe(pre);
    expect(out[0].anchorEl).not.toBe(marker);
  });

  it("[ut-block-anchor-next] resolves block marker anchorEl to the next sibling", () => {
    const root = document.createElement("div");
    const marker = document.createElement("div");
    marker.className = "vd-block-comment";
    marker.dataset.threadId = "cY";
    marker.dataset.target = "next";
    marker.style.display = "none";
    const pre = document.createElement("pre");
    pre.textContent = "code";
    root.append(marker, pre);
    document.body.appendChild(root);
    const source = "{>>block id:cY target:next | by:@a 2026: hi<<}";
    const out = scanThreads(root, source);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("block");
    expect(out[0].anchorEl).toBe(pre);
    expect(out[0].anchorEl).not.toBe(marker);
  });

  it("[ut-block-anchor-fallback] falls back to the marker when the targeted sibling is missing", () => {
    const root = document.createElement("div");
    const marker = document.createElement("div");
    marker.className = "vd-block-comment";
    marker.dataset.threadId = "cZ";
    marker.dataset.target = "prev";
    // No previous sibling — fallback should keep the marker as anchor.
    root.append(marker);
    document.body.appendChild(root);
    const source = "{>>block id:cZ target:prev | by:@a 2026: hi<<}";
    const out = scanThreads(root, source);
    expect(out).toHaveLength(1);
    expect(out[0].anchorEl).toBe(marker);
  });

  it("[ut-inline-not-block] inline comment half is not picked up as a block thread", () => {
    // The comment half of `{==...==}{>>...<<}` matches BLOCK_PATTERN but must
    // never be indexed as a block thread. Without a corresponding inline
    // anchor in the DOM, scanThreads should return empty.
    const root = document.createElement("div");
    document.body.appendChild(root);
    const source = "x {==y==}{>>id:cn | by:@a 2026-01-01: hi<<} z";
    expect(scanThreads(root, source)).toEqual([]);
  });

  it("[ut-multiline] still recognises a single thread when the body contains escaped newlines", () => {
    const root = document.createElement("div");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    mark.dataset.threadId = "ml";
    mark.dataset.critic = "highlight";
    root.appendChild(mark);
    document.body.appendChild(root);
    // The body holds an escaped real newline plus a literal `\n` token; the
    // regex must accept both forms inside the marker.
    const source =
      "x {==y==}{>>id:ml | by:@a 2026-01-01: line one\\nline two<<} z";
    const out = scanThreads(root, source);
    expect(out).toHaveLength(1);
    expect(out[0].thread.messages[0]?.text).toBe("line one\nline two");
  });

  it("[ut-orphan] skips anchors whose id is not in the source", () => {
    const root = document.createElement("div");
    const mark = document.createElement("mark");
    mark.className = "vd-comment-anchor";
    mark.dataset.threadId = "ghost";
    mark.dataset.critic = "highlight";
    root.appendChild(mark);
    document.body.appendChild(root);
    expect(scanThreads(root, "no comments here")).toHaveLength(0);
  });
});
