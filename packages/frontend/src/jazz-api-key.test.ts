import { describe, it, expect } from "vitest";
import { resolveJazzSyncConfig } from "./jazz-api-key";

describe("resolveJazzSyncConfig", () => {
  it("returns env sync peer when ws:// is provided", () => {
    const result = resolveJazzSyncConfig("ws://localhost:4200", null, null);
    expect(result).toEqual({ peer: "ws://localhost:4200" });
  });

  it("returns env sync peer when wss:// is provided", () => {
    const result = resolveJazzSyncConfig(
      "wss://custom.sync.server",
      null,
      null,
    );
    expect(result).toEqual({ peer: "wss://custom.sync.server" });
  });

  it("ignores env var that is not a ws/wss URL", () => {
    const result = resolveJazzSyncConfig("http://localhost:4200", null, null);
    expect(result).toBeNull();
  });

  it("ignores non-string env var", () => {
    expect(resolveJazzSyncConfig(undefined, null, null)).toBeNull();
    expect(resolveJazzSyncConfig(42, null, null)).toBeNull();
    expect(resolveJazzSyncConfig(true, null, null)).toBeNull();
  });

  it("returns cloud peer URL when API key is provided", () => {
    const result = resolveJazzSyncConfig(undefined, "my-key", null);
    expect(result).toEqual({
      peer: "wss://cloud.jazz.tools/?key=my-key",
    });
  });

  it("URL-encodes the API key", () => {
    const result = resolveJazzSyncConfig(
      undefined,
      "key with spaces&stuff",
      null,
    );
    expect(result).toEqual({
      peer: "wss://cloud.jazz.tools/?key=key%20with%20spaces%26stuff",
    });
  });

  it("returns local-only config when flag is set", () => {
    const result = resolveJazzSyncConfig(undefined, null, "true");
    expect(result).toEqual({ when: "never" });
  });

  it("returns null when nothing is configured", () => {
    expect(resolveJazzSyncConfig(undefined, null, null)).toBeNull();
    expect(resolveJazzSyncConfig(undefined, null, "false")).toBeNull();
    expect(resolveJazzSyncConfig(undefined, "", null)).toBeNull();
  });

  describe("priority ordering", () => {
    it("env var wins over API key", () => {
      const result = resolveJazzSyncConfig(
        "ws://localhost:4200",
        "my-key",
        "true",
      );
      expect(result).toEqual({ peer: "ws://localhost:4200" });
    });

    it("API key wins over local-only flag", () => {
      const result = resolveJazzSyncConfig(undefined, "my-key", "true");
      expect(result).toEqual({
        peer: "wss://cloud.jazz.tools/?key=my-key",
      });
    });
  });
});
