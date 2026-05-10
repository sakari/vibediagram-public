import { describe, it, expect } from "vitest";
import * as api from "./index";

describe("public API barrel", () => {
  it("re-exports the documented surface", () => {
    expect(typeof api.parseInlineBody).toBe("function");
    expect(typeof api.parseBlockBody).toBe("function");
    expect(typeof api.serializeInlineBody).toBe("function");
    expect(typeof api.serializeBlockBody).toBe("function");
    expect(typeof api.appendReply).toBe("function");
    expect(typeof api.setResolved).toBe("function");
    expect(typeof api.generateId).toBe("function");
    expect(typeof api.preprocessCriticMarkup).toBe("function");
    expect(typeof api.rehypeCriticmarkup).toBe("function");
    expect(typeof api.repairCriticMarkup).toBe("function");
    expect(typeof api.InvalidBodyError).toBe("function");
    expect(typeof api.escapeBodyText).toBe("function");
    expect(typeof api.unescapeBodyText).toBe("function");
    expect(typeof api.escapeHighlightExact).toBe("function");
    expect(typeof api.unescapeHighlightExact).toBe("function");
  });
});
