/**
 * Tests for VibeDiagramAccount migration logic.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupJazzTestSync, createJazzTestAccount } from "jazz-tools/testing";
import { VibeDiagramAccount } from "./index.js";

describe("VibeDiagramAccount migration", () => {
  beforeEach(async () => {
    await setupJazzTestSync();
  });

  it("initializes root with empty projects on new account", async () => {
    const account = await createJazzTestAccount({
      AccountSchema: VibeDiagramAccount,
      isCurrentActiveAccount: true,
    });

    expect(account.root).toBeDefined();
    expect(account.root.projects).toBeDefined();
    expect(account.root.projects.length).toBe(0);
  });
});
