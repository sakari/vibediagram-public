import { MemoryFileStore } from "../src/store/MemoryFileStore.js";
import { WorkerClient } from "@diagram/ts-worker";
import { EditorStateManager } from "../src/state/EditorStateManager.js";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { getThemeExtension } from "../src/theme.js";

/** @public */
export interface TestEditorHarness {
  store: MemoryFileStore;
  client: WorkerClient;
  manager: EditorStateManager;
  view: EditorView;
  container: HTMLDivElement;
  cleanup: () => void;
}

/**
 * Creates a test harness: MemoryFileStore, Worker, WorkerClient, EditorStateManager,
 * and EditorView. All files are synced to the worker; if initialFile is provided,
 * that file is opened in the editor.
 *
 * @param files - Initial files (path -> content)
 * @param options - Optional initialFile to open
 * @returns Harness with store, client, manager, view, container, and cleanup fn
 */
export async function createTestEditor(
  files: Record<string, string>,
  options?: { initialFile?: string },
): Promise<TestEditorHarness> {
  const store = new MemoryFileStore(files);
  const worker = new Worker(
    new URL("../../ts-worker/src/worker.ts", import.meta.url),
    { type: "module" },
  );
  const client = new WorkerClient(worker);

  await client.init({}, undefined);

  const fileList = store.listFiles();
  for (const path of fileList) {
    const content = store.readFile(path);
    if (content !== undefined) {
      await client.syncFile(path, content);
    }
  }

  const handleTabsChange = () => {};
  const manager = new EditorStateManager(
    store,
    client,
    () => {},
    handleTabsChange,
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const themeExt = getThemeExtension("light");
  const view = new EditorView({
    state: EditorState.create({ extensions: [themeExt] }),
    parent: container,
  });

  manager.attachView(view);
  manager.subscribe();

  if (options?.initialFile) {
    manager.openFile(options.initialFile);
  }

  const cleanup = () => {
    manager.detachView();
    manager.dispose();
    view.destroy();
    container.remove();
    client.terminate();
  };

  return {
    store,
    client,
    manager,
    view,
    container,
    cleanup,
  };
}
