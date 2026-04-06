import { describe, it, expect } from "vitest";
import { MicrotaskFlush } from "./flush";

describe("MicrotaskFlush", () => {
  describe("[flush-drains]", () => {
    it("after resolving a promise and calling flush(), all .then() chains have completed", async () => {
      const flusher = new MicrotaskFlush();
      let flag = false;
      void Promise.resolve().then(() => {
        flag = true;
      });

      expect(flag).toBe(false);
      await flusher.flush();
      expect(flag).toBe(true);
    });

    it("drains chained promises (multiple .then levels)", async () => {
      const flusher = new MicrotaskFlush();
      const flags = [false, false, false];

      void Promise.resolve()
        .then(() => {
          flags[0] = true;
        })
        .then(() => {
          flags[1] = true;
        })
        .then(() => {
          flags[2] = true;
        });

      expect(flags).toEqual([false, false, false]);
      await flusher.flush();
      expect(flags).toEqual([true, true, true]);
    });
  });
});
