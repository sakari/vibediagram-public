import { startWorker } from "jazz-tools/worker";
import { PureJSCrypto } from "cojson/crypto/PureJSCrypto";
import Fuse from "fuse-native";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Command } from "commander";
import { DiagramProject } from "@diagram/jazz-schema";
import { FuseHandlers } from "./fuse-handlers.js";
import { consoleLogger } from "./logger.js";
import { generateSimModelDeclarations } from "@diagram/ts-worker/vite-plugin-sim-model-dts";
import { generateHelpFiles } from "./help-content.js";
import type { co } from "jazz-tools";

type LoadedProject = co.loaded<typeof DiagramProject>;

/** Shape of values read from the config file at ~/.config/vibediagram/config.json */
export interface ConfigFile {
  jazzApiKey?: string;
  workerAccount?: string;
  workerSecret?: string;
}

export interface MainOptions {
  projectId: string;
  mountPath: string;
  accountID: string;
  accountSecret: string;
  jazzApiKey?: string;
  syncServer?: string;
}

/**
 * Load configuration from the user's config file.
 * Returns parsed values or an empty object if the file is missing or invalid.
 * Config path: $XDG_CONFIG_HOME/vibediagram/config.json (defaults to ~/.config/vibediagram/config.json)
 */
export function loadConfig(): ConfigFile {
  const configDir =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const configPath = path.join(configDir, "vibediagram", "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    // Config file should be a plain object; return empty config for unexpected shapes
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const obj = parsed as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- validated above
    return {
      ...(typeof obj.jazzApiKey === "string" && { jazzApiKey: obj.jazzApiKey }),
      ...(typeof obj.workerAccount === "string" && {
        workerAccount: obj.workerAccount,
      }),
      ...(typeof obj.workerSecret === "string" && {
        workerSecret: obj.workerSecret,
      }),
    };
  } catch {
    // Config file missing or unreadable — not an error
    return {};
  }
}

export function parseArgs(argv: string[]): MainOptions {
  const program = new Command()
    .name("fuse-mirror")
    .description("Mount Jazz DiagramProject files as a local FUSE filesystem")
    .argument("<project-id>", "Jazz CoMap ID of the DiagramProject")
    .option("--mount <path>", "mount point path")
    .option("--api-key <key>", "Jazz API key for cloud sync")
    .exitOverride()
    .parse(argv);

  const cliOpts = program.opts<{ mount?: string; apiKey?: string }>();
  const config = loadConfig();

  const projectId = program.args[0];
  const mountPath =
    cliOpts.mount ?? path.join(".", "vibediagram-mount", projectId);

  // Priority: CLI flag > env var > config file
  const jazzApiKey =
    cliOpts.apiKey ?? process.env.JAZZ_API_KEY ?? config.jazzApiKey;
  const accountID = process.env.JAZZ_WORKER_ACCOUNT ?? config.workerAccount;
  const accountSecret = process.env.JAZZ_WORKER_SECRET ?? config.workerSecret;

  if (!accountID || !accountSecret) {
    throw new Error(
      "Worker credentials required. Provide JAZZ_WORKER_ACCOUNT and JAZZ_WORKER_SECRET\n" +
        "environment variables or set workerAccount/workerSecret in\n" +
        "~/.config/vibediagram/config.json.\n" +
        "Create credentials with: npx jazz-run account create --name 'fuse-mirror'",
    );
  }

  return { projectId, mountPath, accountID, accountSecret, jazzApiKey };
}

export async function main(opts: MainOptions) {
  let syncServer: string;
  if (opts.syncServer) {
    // Explicit sync server for testing — skip API key requirement
    syncServer = opts.syncServer;
  } else if (opts.jazzApiKey) {
    syncServer = `wss://cloud.jazz.tools/?key=${encodeURIComponent(opts.jazzApiKey)}`;
  } else {
    throw new Error(
      "Jazz API key required for cloud sync.\n" +
        "Set it via --api-key flag, JAZZ_API_KEY environment variable,\n" +
        "or jazzApiKey in ~/.config/vibediagram/config.json.",
    );
  }

  // Check FUSE availability (test /dev/fuse directly — Fuse.isConfigured
  // only checks if the bundled fuse-shared-library scripts are root-owned,
  // which is unreliable when the system has fuse3 installed natively).
  if (!fs.existsSync("/dev/fuse")) {
    throw new Error(
      "FUSE is not available (/dev/fuse not found).\n" +
        "Linux: sudo apt-get install fuse3 libfuse-dev\n" +
        "macOS: Install macFUSE from https://osxfuse.github.io/\n" +
        "Docker: add --device=/dev/fuse --cap-add=SYS_ADMIN",
    );
  }

  console.log("Connecting to Jazz Cloud...");

  const { worker } = await startWorker({
    syncServer,
    accountID: opts.accountID,
    accountSecret: opts.accountSecret,
    crypto: await PureJSCrypto.create(),
  });

  console.log("Connected. Loading project...");

  // Load the project with deep resolution via subscribe.
  // The subscription keeps the project object in sync for the lifetime
  // of the process. FuseHandlers reads directly from it.
  const project = await new Promise<LoadedProject>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout loading project"));
    }, 30000);

    DiagramProject.subscribe(
      opts.projectId,
      {
        resolve: { files: { $each: { content: true } } },
        loadAs: worker,
      },
      (value) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- files may not be loaded yet
        if (value.files) {
          clearTimeout(timeout);
          resolve(value as LoadedProject);
        }
      },
    );
  });

  const group = project.$jazz.owner;

  // List files
  const files = project.files;
  const filePaths: string[] = [];
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry?.path) filePaths.push(entry.path);
    }
  }

  console.log("Loaded project: %s", project.title);
  console.log("Files (%d):", filePaths.length);
  for (const p of filePaths) {
    console.log("  %s", p);
  }

  // Create mount point
  fs.mkdirSync(opts.mountPath, { recursive: true });
  const absoluteMount = path.resolve(opts.mountPath);

  // Generate type declarations for editor support
  console.log("Generating type declarations...");
  const declarationEntries = generateSimModelDeclarations();
  const helpFiles = generateHelpFiles();
  const staticFiles = new Map<string, string>([
    [
      "/node_modules/@diagram/sim-model/package.json",
      JSON.stringify({ name: "@diagram/sim-model", types: "index.d.ts" }),
    ],
    ...declarationEntries.map(
      ({ path: p, content }) => [p, content] as [string, string],
    ),
    [
      "/tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
          },
        },
        null,
        2,
      ),
    ],
    ...helpFiles,
  ]);

  // Set up FUSE handlers
  const handlers = new FuseHandlers(project, group, {
    logger: consoleLogger,
    staticFiles,
  });
  const ops = handlers.getOperations();

  const fuse = new Fuse(absoluteMount, ops, { force: true, mkdir: true });

  // Mount
  await new Promise<void>((resolve, reject) => {
    fuse.mount((err: Error | null) => {
      if (err) {
        reject(new Error(`Mount failed: ${err.message}`));
        return;
      }
      resolve();
    });
  });

  console.log("\nMounted at: %s", absoluteMount);
  console.log("Edit files with your text editor. Changes sync to Jazz Cloud.");
  console.log("Press Ctrl+C to unmount and exit.\n");

  // Graceful shutdown (guarded against double invocation)
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nUnmounting...");
    fuse.unmount((err: Error | null) => {
      if (err) {
        console.error("Unmount error:", err.message);
        process.exit(1);
      }
      console.log("Unmounted. Goodbye.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
