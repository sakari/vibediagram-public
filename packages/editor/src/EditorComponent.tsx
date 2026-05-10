import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { WorkerClient } from "@diagram/ts-worker";
import type { Reference } from "@diagram/ts-worker";

import { EditorStateManager } from "./state/EditorStateManager.js";
import type { FileStore } from "./store/types.js";
import type { Diagnostic } from "@diagram/ts-worker";
import { TabBar } from "./TabBar.js";
import { ReferencesPanel, type ReferenceItem } from "./ReferencesPanel.js";
import { getThemeExtension } from "./theme.js";

/**
 * Result of a compile operation: emitted files and diagnostics.
 */
export interface CompileResult {
  files: { path: string; content: string }[];
  diagnostics: Diagnostic[];
}

/**
 * Props for the EditorComponent.
 */
export interface EditorProps {
  /** File store for reading and writing virtual files. */
  fileStore: FileStore;
  /** Path to open initially. If not provided, no file is opened. */
  initialFile?: string;
  /** TypeScript compiler options passed to the worker. */
  tsConfig?: Record<string, unknown>;
  /** Extra lib files (path + content) for the worker. */
  extraLibs?: { path: string; content: string }[];
  /** Callback invoked when a compile completes (e.g. via imperative handle). */
  onCompile?: (result: CompileResult) => void;
  /** Callback invoked when the active tab changes (path or null if none). */
  onActiveTabChange?: (path: string | null) => void;
  /** Callback invoked when document content changes locally (e.g. user typing). */
  onContentChange?: () => void;
  /** Callback invoked when go-to-definition targets a different file. */
  onNavigate?: (targetPath: string, targetOffset: number) => void;
  /** Visual theme. Defaults to "light". */
  theme?: "light" | "dark";
  /** When true, the editor is non-editable (view-only mode). */
  readOnly?: boolean;
  /** Optional CSS class for the root container. */
  className?: string;
}

/**
 * Imperative handle exposed by EditorComponent via ref.
 */
export interface EditorHandle {
  /** Compiles the entry file and returns emitted files and diagnostics. */
  compile(entryPath: string): Promise<CompileResult>;
  /** Opens a file in a tab. Optionally provide content for files not in the store and a cursor offset. */
  openFile(path: string, fallbackContent?: string, cursorOffset?: number): void;
  /**
   * Returns the underlying CodeMirror EditorView, or `null` if the editor has
   * not finished mounting yet (or has been unmounted). Consumers can use this
   * to dispatch transactions or read editor state directly — for example, to
   * drive the editor from another pane (e.g. a markdown preview).
   */
  getEditorView(): EditorView | null;
}

function offsetToLine(
  content: string,
  offset: number,
): { line: number; lineText: string } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  const lineEnd = content.indexOf("\n", lineStart);
  const lineText = content.slice(
    lineStart,
    lineEnd === -1 ? undefined : lineEnd,
  );
  return { line, lineText };
}

function enrichReferences(
  refs: Reference[],
  fileStore: FileStore,
  extraLibs: { path: string; content: string }[] | undefined,
  manager: EditorStateManager | null,
): ReferenceItem[] {
  return refs.map((ref) => {
    const content =
      manager?.getDocContent(ref.path) ??
      fileStore.readFile(ref.path) ??
      extraLibs?.find((f) => f.path === ref.path)?.content ??
      "";
    const { line, lineText } = offsetToLine(content, ref.start);
    return { path: ref.path, start: ref.start, end: ref.end, line, lineText };
  });
}

/**
 * React component that wraps EditorStateManager, manages the Worker lifecycle,
 * and renders the tab bar plus CodeMirror mount point.
 */
export const EditorComponent = forwardRef<EditorHandle, EditorProps>(
  function EditorComponent(
    {
      fileStore,
      initialFile,
      tsConfig = {},
      extraLibs,
      onCompile,
      onActiveTabChange,
      onContentChange,
      onNavigate,
      theme = "light",
      readOnly,
      className,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const managerRef = useRef<EditorStateManager | null>(null);
    const workerClientRef = useRef<WorkerClient | null>(null);

    // Capture initial mount values so the setup effect doesn't need them as deps.
    // These are intentionally read once on mount (worker/editor lifecycle is not
    // re-created when these change — they are configuration at construction time).
    const tsConfigRef = useRef(tsConfig);
    const extraLibsRef = useRef(extraLibs);
    const fileStoreRef = useRef(fileStore);
    const initialFileRef = useRef(initialFile);
    const themeRef = useRef(theme);
    const readOnlyRef = useRef(readOnly);

    const [tabs, setTabs] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [referenceItems, setReferenceItems] = useState<
      ReferenceItem[] | null
    >(null);

    const onActiveTabChangeRef = useRef(onActiveTabChange);
    const onContentChangeRef = useRef(onContentChange);
    const onNavigateRef = useRef(onNavigate);

    // Update the callback refs in a layout effect to avoid updating ref during render
    useEffect(() => {
      onActiveTabChangeRef.current = onActiveTabChange;
      onContentChangeRef.current = onContentChange;
      onNavigateRef.current = onNavigate;
    });

    const handleTabsChange = useCallback(
      (newTabs: string[], newActiveTab: string | null) => {
        setTabs(newTabs);
        setActiveTab(newActiveTab);
        onActiveTabChangeRef.current?.(newActiveTab);
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        async compile(entryPath: string): Promise<CompileResult> {
          const client = workerClientRef.current;
          if (!client) {
            throw new Error("Editor not initialized");
          }
          const result = await client.compile(entryPath);
          onCompile?.(result);
          return result;
        },
        openFile(
          path: string,
          fallbackContent?: string,
          cursorOffset?: number,
        ): void {
          managerRef.current?.openFile(path, fallbackContent, cursorOffset);
        },
        getEditorView(): EditorView | null {
          return viewRef.current;
        },
      }),
      [onCompile],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const worker = new Worker(
        new URL("../../ts-worker/src/worker.ts", import.meta.url),
        { type: "module" },
      );
      const client = new WorkerClient(worker);

      let cancelled = false;

      const initAndMount = async () => {
        const currentFileStore = fileStoreRef.current;
        await client.init(tsConfigRef.current, extraLibsRef.current);

        const files = currentFileStore.listFiles();
        for (const path of files) {
          await client.syncFile(path, currentFileStore.readFile(path) ?? "");
        }

        if (cancelled) return;

        const manager = new EditorStateManager(
          currentFileStore,
          client,
          (targetPath, targetOffset) => {
            if (onNavigateRef.current) {
              onNavigateRef.current(targetPath, targetOffset);
            } else {
              manager.openFile(targetPath, undefined, targetOffset);
            }
          },
          handleTabsChange,
          () => onContentChangeRef.current?.(),
          (refs) => {
            const items = enrichReferences(
              refs,
              currentFileStore,
              extraLibsRef.current,
              manager,
            );
            setReferenceItems(items);
          },
          readOnlyRef.current,
        );
        managerRef.current = manager;

        const themeExt = getThemeExtension(themeRef.current);
        const view = new EditorView({
          state: EditorState.create({ extensions: [themeExt] }),
          parent: container,
        });
        viewRef.current = view;

        manager.attachView(view);
        manager.subscribe();

        const currentInitialFile = initialFileRef.current;
        if (currentInitialFile) {
          manager.openFile(currentInitialFile);
          if (!files.includes(currentInitialFile)) {
            await client.syncFile(
              currentInitialFile,
              currentFileStore.readFile(currentInitialFile) ?? "",
            );
          }
        }

        workerClientRef.current = client;
      };

      initAndMount().catch((err: unknown) => {
        if (!cancelled) {
          console.error("Editor init failed:", err);
        }
      });

      return () => {
        cancelled = true;
        managerRef.current?.detachView();
        managerRef.current?.dispose();
        managerRef.current = null;
        viewRef.current?.destroy();
        viewRef.current = null;
        client.terminate();

        workerClientRef.current = null;
      };
    }, [handleTabsChange]);

    const handleSelectTab = useCallback((path: string) => {
      managerRef.current?.switchToFile(path);
    }, []);

    const handleCloseTab = useCallback((path: string) => {
      managerRef.current?.closeFile(path);
    }, []);

    const handleRefSelect = useCallback((ref: ReferenceItem) => {
      if (onNavigateRef.current) {
        onNavigateRef.current(ref.path, ref.start);
      } else {
        managerRef.current?.openFile(ref.path, undefined, ref.start);
      }
    }, []);

    const handleRefClose = useCallback(() => {
      setReferenceItems(null);
    }, []);

    return (
      <div
        className={className}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <TabBar
          tabs={tabs}
          activeTab={activeTab}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
        />
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: "auto",
          }}
        />
        {referenceItems && (
          <ReferencesPanel
            references={referenceItems}
            currentFile={activeTab}
            onSelect={handleRefSelect}
            onClose={handleRefClose}
          />
        )}
      </div>
    );
  },
);
