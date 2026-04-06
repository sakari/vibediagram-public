import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// fuse-native requires libfuse native library; mock it so unit tests run anywhere
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- mock only needs an empty class
vi.mock("fuse-native", () => ({ default: class {} }));

import { loadConfig, parseArgs } from "./main.js";

describe("loadConfig", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuse-config-test-"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when config file does not exist", () => {
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, "nonexistent");
    expect(loadConfig()).toEqual({});
  });

  it("reads config values from XDG_CONFIG_HOME", () => {
    const configDir = path.join(tmpDir, "vibediagram");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        jazzApiKey: "test-key-123",
        workerAccount: "worker-acct",
        workerSecret: "worker-secret",
      }),
    );
    process.env.XDG_CONFIG_HOME = tmpDir;

    const config = loadConfig();
    expect(config).toEqual({
      jazzApiKey: "test-key-123",
      workerAccount: "worker-acct",
      workerSecret: "worker-secret",
    });
  });

  it("returns empty object for invalid JSON", () => {
    const configDir = path.join(tmpDir, "vibediagram");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), "not json{{{");
    process.env.XDG_CONFIG_HOME = tmpDir;

    expect(loadConfig()).toEqual({});
  });

  it("returns partial config when only some fields are present", () => {
    const configDir = path.join(tmpDir, "vibediagram");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ jazzApiKey: "only-key" }),
    );
    process.env.XDG_CONFIG_HOME = tmpDir;

    expect(loadConfig()).toEqual({ jazzApiKey: "only-key" });
  });
});

describe("parseArgs", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuse-config-test-"));
    // Point config to empty dir so loadConfig returns {}
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, "empty");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses env vars for worker credentials", () => {
    process.env.JAZZ_WORKER_ACCOUNT = "env-acct";
    process.env.JAZZ_WORKER_SECRET = "env-secret";
    delete process.env.JAZZ_API_KEY;

    const opts = parseArgs(["node", "cli", "project-123"]);
    expect(opts).toEqual(
      expect.objectContaining({
        projectId: "project-123",
        accountID: "env-acct",
        accountSecret: "env-secret",
      }),
    );
  });

  it("reads worker credentials from config file", () => {
    delete process.env.JAZZ_WORKER_ACCOUNT;
    delete process.env.JAZZ_WORKER_SECRET;
    delete process.env.JAZZ_API_KEY;

    const configDir = path.join(tmpDir, "vibediagram");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        workerAccount: "cfg-acct",
        workerSecret: "cfg-secret",
        jazzApiKey: "cfg-key",
      }),
    );
    process.env.XDG_CONFIG_HOME = tmpDir;

    const opts = parseArgs(["node", "cli", "project-123"]);
    expect(opts).toEqual(
      expect.objectContaining({
        accountID: "cfg-acct",
        accountSecret: "cfg-secret",
        jazzApiKey: "cfg-key",
      }),
    );
  });

  it("env vars take priority over config file values", () => {
    process.env.JAZZ_WORKER_ACCOUNT = "env-acct";
    process.env.JAZZ_WORKER_SECRET = "env-secret";
    process.env.JAZZ_API_KEY = "env-key";

    const configDir = path.join(tmpDir, "vibediagram");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        workerAccount: "cfg-acct",
        workerSecret: "cfg-secret",
        jazzApiKey: "cfg-key",
      }),
    );
    process.env.XDG_CONFIG_HOME = tmpDir;

    const opts = parseArgs(["node", "cli", "project-123"]);
    expect(opts).toEqual(
      expect.objectContaining({
        accountID: "env-acct",
        accountSecret: "env-secret",
        jazzApiKey: "env-key",
      }),
    );
  });

  it("--api-key flag takes highest priority", () => {
    process.env.JAZZ_WORKER_ACCOUNT = "env-acct";
    process.env.JAZZ_WORKER_SECRET = "env-secret";
    process.env.JAZZ_API_KEY = "env-key";

    const opts = parseArgs([
      "node",
      "cli",
      "project-123",
      "--api-key",
      "cli-key",
    ]);
    expect(opts.jazzApiKey).toBe("cli-key");
  });

  it("throws when worker credentials are missing from both env and config", () => {
    delete process.env.JAZZ_WORKER_ACCOUNT;
    delete process.env.JAZZ_WORKER_SECRET;
    delete process.env.JAZZ_API_KEY;

    expect(() => parseArgs(["node", "cli", "project-123"])).toThrow(
      /Worker credentials required/,
    );
    expect(() => parseArgs(["node", "cli", "project-123"])).toThrow(
      /config\.json/,
    );
  });
});
