import { describe, it, expect } from "vitest";
import { repairCriticMarkup } from "./repair";

describe("repairCriticMarkup", () => {
  it("returns source unchanged when nothing is wrong", () => {
    const src = "Hello {==world==}{>>id:c1<<}!";
    const r = repairCriticMarkup(src);
    expect(r.source).toBe(src);
    expect(r.issues).toHaveLength(0);
  });

  it("renumbers duplicate inline ids", () => {
    const src = "{==a==}{>>id:c1<<} and {==b==}{>>id:c1<<}";
    const r = repairCriticMarkup(src);
    expect(r.source).not.toBe(src);
    const issue = r.issues.find((i) => i.code === "duplicate-id");
    expect(issue).toBeDefined();
    const idMatches = [...r.source.matchAll(/id:([A-Za-z0-9-]+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(idMatches).size).toBe(idMatches.length);
  });

  it("renumbers duplicate block ids", () => {
    const src =
      "{>>block id:c1 target:next<<}\n\n```\nx\n```\n\n{>>block id:c1 target:prev<<}";
    const r = repairCriticMarkup(src);
    const issue = r.issues.find((i) => i.code === "duplicate-id");
    expect(issue).toBeDefined();
  });

  it("infers target:next on a block marker followed by a fence", () => {
    const src = "{>>block id:c1 | by:@a 2026: see below<<}\n\n```\nfoo\n```\n";
    const r = repairCriticMarkup(src);
    const issue = r.issues.find((i) => i.code === "missing-target-inferred");
    expect(issue).toBeDefined();
    expect(r.source).toContain("target:next");
  });

  it("infers target:next when the fence uses tildes", () => {
    const src = "{>>block id:c1 | by:@a 2026: hi<<}\n\n~~~\nfoo\n~~~\n";
    const r = repairCriticMarkup(src);
    expect(r.source).toContain("target:next");
  });

  it("flags a block marker without target and without a following fence", () => {
    const src = "{>>block id:c1 | by:@a 2026: hi<<}\n\nplain paragraph\n";
    const r = repairCriticMarkup(src);
    expect(r.issues.some((i) => i.code === "malformed-block")).toBe(true);
    expect(r.source).toBe(src);
  });

  it("flags a highlight without a comment", () => {
    const src = "Plain {==orphan==} text";
    const r = repairCriticMarkup(src);
    expect(r.issues.some((i) => i.code === "highlight-without-comment")).toBe(
      true,
    );
  });

  it("flags an unclosed highlight marker", () => {
    const src = "Plain {== unclosed";
    const r = repairCriticMarkup(src);
    expect(r.issues.some((i) => i.code === "unclosed-highlight")).toBe(true);
  });

  it("flags an unclosed comment marker", () => {
    const src = "Plain {>> unclosed";
    const r = repairCriticMarkup(src);
    expect(r.issues.some((i) => i.code === "unclosed-comment")).toBe(true);
  });

  it("flags a malformed inline body", () => {
    const src = "Hello {==w==}{>>not valid<<}";
    const r = repairCriticMarkup(src);
    expect(r.issues.some((i) => i.code === "malformed-inline")).toBe(true);
  });

  it("preserves user content (no deletions) on malformed input", () => {
    const src = "{==orphan==} {>>not valid<<}";
    const r = repairCriticMarkup(src);
    expect(r.source).toBe(src);
  });

  it("recognises a marker whose body contains a real newline", () => {
    // Without newline support in the regex, the marker would be reported as
    // unclosed-comment instead of accepted as a valid marker.
    const src = "before {==x==}{>>id:c1 | by:@a 2026: line one\\nline two<<}";
    const r = repairCriticMarkup(src);
    expect(r.issues.some((i) => i.code === "unclosed-comment")).toBe(false);
    expect(r.issues.some((i) => i.code === "malformed-inline")).toBe(false);
  });

  it("regex terminates quickly on adversarial backslash-escape input", () => {
    // Many `\<` pairs followed by an unescaped `<<}` would cause catastrophic
    // backtracking under a naive `[^\n]*?` alternation. Our alternation
    // consumes one char per branch, keeping the worst case linear.
    const body = "\\<".repeat(5000) + "<<}";
    const src = `{==x==}{>>id:c1 | by:@a 2026: ${body}rest`;
    const start = Date.now();
    repairCriticMarkup(src);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it("issue position is line/column based", () => {
    const src = "line1\n{==a==} orphan";
    const r = repairCriticMarkup(src);
    const issue = r.issues.find((i) => i.code === "highlight-without-comment");
    expect(issue?.line).toBe(2);
    expect(issue?.column).toBe(1);
  });
});
