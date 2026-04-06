import type { WorkerRequest, WorkerResponse, WorkerPush } from "./protocol.js";
import { LanguageServiceHost } from "./language-service.js";
import tsLibFiles from "virtual:ts-lib-files";

const host = new LanguageServiceHost();

/** Convert the virtual module Map to a plain Record for the language service. */
const libFilesRecord: Record<string, string> = {};
for (const [k, v] of tsLibFiles) {
  libFilesRecord[k] = v;
}

let diagnosticsPushTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

function scheduleDiagnosticsPush(): void {
  if (diagnosticsPushTimer) return;
  diagnosticsPushTimer = setTimeout(() => {
    diagnosticsPushTimer = null;
    const files = host.getKnownFiles();
    for (const path of files) {
      const diagnostics = host.getDiagnostics(path);
      if (diagnostics.length > 0) {
        const push: WorkerPush = {
          type: "diagnostics-updated",
          path,
          diagnostics,
        };
        self.postMessage(push);
      }
    }
  }, DEBOUNCE_MS);
}

function handleRequest(msg: WorkerRequest): void {
  switch (msg.type) {
    case "init": {
      const tsVersion = host.initialize(
        libFilesRecord,
        msg.compilerOptions,
        msg.extraLibs,
      );
      const response: WorkerResponse = {
        type: "init-done",
        id: msg.id,
        tsVersion,
      };
      self.postMessage(response);
      break;
    }

    case "sync-file": {
      host.syncFile(msg.path, msg.content);
      const syncResp: WorkerResponse = {
        type: "file-synced",
        id: msg.id,
        path: msg.path,
      };
      self.postMessage(syncResp);
      scheduleDiagnosticsPush();
      break;
    }

    case "delete-file": {
      host.deleteFile(msg.path);
      const delResp: WorkerResponse = {
        type: "file-deleted",
        id: msg.id,
        path: msg.path,
      };
      self.postMessage(delResp);
      scheduleDiagnosticsPush();
      break;
    }

    case "get-diagnostics": {
      const diagnostics = host.getDiagnostics(msg.path);
      const diagResp: WorkerResponse = {
        type: "diagnostics",
        id: msg.id,
        path: msg.path,
        diagnostics,
      };
      self.postMessage(diagResp);
      break;
    }

    case "get-completions": {
      const completions = host.getCompletions(msg.path, msg.offset);
      const compResp: WorkerResponse = {
        type: "completions",
        id: msg.id,
        completions,
      };
      self.postMessage(compResp);
      break;
    }

    case "get-quickinfo": {
      const quickinfo = host.getQuickInfo(msg.path, msg.offset);
      const qiResp: WorkerResponse = quickinfo
        ? { type: "quickinfo", id: msg.id, ...quickinfo }
        : {
            type: "quickinfo",
            id: msg.id,
            text: "",
            documentation: "",
            tags: [],
            start: 0,
            length: 0,
          };
      self.postMessage(qiResp);
      break;
    }

    case "get-definition": {
      const def = host.getDefinition(msg.path, msg.offset);
      const defResp: WorkerResponse = def
        ? { type: "definition", id: msg.id, ...def }
        : {
            type: "definition",
            id: msg.id,
            targetPath: "",
            targetOffset: 0,
          };
      self.postMessage(defResp);
      break;
    }

    case "get-references": {
      const references = host.getReferences(msg.path, msg.offset);
      const refsResp: WorkerResponse = {
        type: "references",
        id: msg.id,
        references,
      };
      self.postMessage(refsResp);
      break;
    }

    case "compile": {
      const { files, diagnostics } = host.compile(msg.entryPath);
      const compileResp: WorkerResponse = {
        type: "compiled",
        id: msg.id,
        files,
        diagnostics,
      };
      self.postMessage(compileResp);
      break;
    }
  }
}

self.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  try {
    handleRequest(e.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", id: e.data.id, message });
  }
});
