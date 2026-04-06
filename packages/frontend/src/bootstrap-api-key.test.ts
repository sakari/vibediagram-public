import { describe, it, expect, beforeEach, vi } from "vitest";
import { JAZZ_API_KEY_STORAGE_KEY } from "./jazz-api-key";
import { bootstrapApiKeyFromHash } from "./bootstrap-api-key";

describe("bootstrapApiKeyFromHash", () => {
  const replaceStateSpy = vi.spyOn(history, "replaceState");

  beforeEach(() => {
    localStorage.clear();
    replaceStateSpy.mockClear();
    // Reset hash to empty
    window.location.hash = "";
  });

  it("stores the API key from #apikey=<value> in localStorage", () => {
    window.location.hash = "#apikey=my-test-key-123";

    bootstrapApiKeyFromHash();

    expect(localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY)).toBe(
      "my-test-key-123",
    );
  });

  it("clears the hash from the URL after storing the key", () => {
    window.location.hash = "#apikey=some-key";

    bootstrapApiKeyFromHash();

    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  });

  it("decodes URI-encoded values", () => {
    window.location.hash = "#apikey=key%20with%20spaces";

    bootstrapApiKeyFromHash();

    expect(localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY)).toBe(
      "key with spaces",
    );
  });

  it("does nothing when the hash is empty", () => {
    window.location.hash = "";

    bootstrapApiKeyFromHash();

    expect(localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY)).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the hash has a different format", () => {
    window.location.hash = "#other=value";

    bootstrapApiKeyFromHash();

    expect(localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY)).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("does nothing when #apikey= has an empty value", () => {
    window.location.hash = "#apikey=";

    bootstrapApiKeyFromHash();

    expect(localStorage.getItem(JAZZ_API_KEY_STORAGE_KEY)).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
