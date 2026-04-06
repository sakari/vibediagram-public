import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import type { WorkerClient } from "@diagram/ts-worker";
import type { FileStore } from "../store/types.js";
import { tsExtensions, isRemote } from "../ts-extensions/index.js";

/**
 * Character-level diff for applyRemoteChange. Finds first and last differing
 * index, returns the range to replace and the new text. Exported for tests.
 */
export function diff(
  oldStr: string,
  newStr: string,
): { from: number; to: number; insert: string } | null {
  if (oldStr === newStr) return null;
  let from = 0;
  while (
    from < oldStr.length &&
    from < newStr.length &&
    oldStr[from] === newStr[from]
  )
    from++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (
    oldEnd > from &&
    newEnd > from &&
    oldStr[oldEnd - 1] === newStr[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  return {
    from,
    to: oldEnd,
    insert: newStr.slice(from, newEnd),
  };
}

/**
 * Manages per-file CodeMirror EditorState instances, tab switching, and
 * collaborative sync. Sits between FileStore and EditorView.
 */
export class EditorStateManager {
  private states = new Map<string, EditorState>();
  private scrollPositions = new Map<string, { left: number; top: number }>();
  private openTabs: string[] = [];
  private activeTab: string | null = null;
  private view: EditorView | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly fileStore: FileStore,
    private readonly workerClient: WorkerClient,
    private readonly onNavigate: (path: string, offset: number) => void,
    private readonly onTabsChange: (
      tabs: string[],
      activeTab: string | null,
    ) => void,
    private readonly onContentChange?: () => void,
    private readonly onReferences?: (
      references: { path: string; start: number; end: number }[],
    ) => void,
    /** When true, the editor is non-editable and does not write back to the file store. */
    private readonly readOnly?: boolean,
  ) {}

  /**
   * Called when the React component mounts the EditorView. Stores the reference.
   */
  attachView(view: EditorView): void {
    this.view = view;
  }

  /**
   * Called on unmount. Clears the view reference.
   */
  detachView(): void {
    this.view = null;
  }

  /**
   * Opens a file in a tab. If already open, switches to it. Otherwise reads
   * from FileStore (or uses the provided fallback content), creates
   * EditorState with TS extensions, and switches.
   */
  openFile(
    path: string,
    fallbackContent?: string,
    cursorOffset?: number,
  ): void {
    if (this.openTabs.includes(path)) {
      this.switchToFile(path);
      if (cursorOffset != null) this.setCursor(cursorOffset);
      return;
    }

    const content = this.fileStore.readFile(path) ?? fallbackContent ?? "";
    const extensions = this.buildExtensions(path);
    const selection =
      cursorOffset != null ? { anchor: cursorOffset } : undefined;
    const state = EditorState.create({
      doc: content,
      extensions,
      selection,
    });
    this.states.set(path, state);
    this.openTabs.push(path);
    this.switchToFile(path);
    if (cursorOffset != null) this.setCursor(cursorOffset);
  }

  /**
   * Switches the EditorView to show a different file. Saves and restores scroll.
   * If the tab exists but has no state (e.g. added via handleFileCreated), creates it.
   */
  switchToFile(path: string): void {
    if (!this.states.has(path)) {
      if (this.openTabs.includes(path)) {
        const content = this.fileStore.readFile(path) ?? "";
        const state = EditorState.create({
          doc: content,
          extensions: this.buildExtensions(path),
        });
        this.states.set(path, state);
      } else {
        return;
      }
    }

    const state = this.states.get(path);
    if (!state) return;

    if (this.view) {
      if (this.activeTab !== null) {
        // Persist the live EditorState so edits survive tab switches
        this.states.set(this.activeTab, this.view.state);
        const scrollLeft = this.view.scrollDOM.scrollLeft;
        const scrollTop = this.view.scrollDOM.scrollTop;
        this.scrollPositions.set(this.activeTab, {
          left: scrollLeft,
          top: scrollTop,
        });
      }

      this.view.setState(state);
      this.view.contentDOM.focus();

      // Restore scroll for target tab
      const saved = this.scrollPositions.get(path);
      if (saved != null) {
        this.view.scrollDOM.scrollLeft = saved.left;
        this.view.scrollDOM.scrollTop = saved.top;
      }
    }

    this.activeTab = path;
    this.onTabsChange([...this.openTabs], this.activeTab);
  }

  /**
   * Moves the cursor to the given offset and scrolls it into view.
   */
  private setCursor(offset: number): void {
    if (!this.view) return;
    this.view.dispatch({
      selection: { anchor: offset },
      effects: EditorView.scrollIntoView(offset, { y: "center" }),
    });
  }

  /**
   * Closes a tab. If it was active, switches to previous or first remaining tab.
   */
  closeFile(path: string): void {
    if (!this.openTabs.includes(path)) return;

    const idx = this.openTabs.indexOf(path);
    this.openTabs.splice(idx, 1);
    this.states.delete(path);
    this.scrollPositions.delete(path);

    if (this.activeTab === path) {
      if (this.openTabs.length === 0) {
        this.activeTab = null;
        if (this.view) {
          this.view.setState(EditorState.create());
        }
      } else {
        const nextPath = idx > 0 ? this.openTabs[idx - 1] : this.openTabs[0];
        this.switchToFile(nextPath);
      }
    }

    this.onTabsChange([...this.openTabs], this.activeTab);
  }

  /** Returns a copy of the open tab paths. */
  getOpenTabs(): string[] {
    return [...this.openTabs];
  }

  /** Returns the path of the currently active tab, or null. */
  getActiveTab(): string | null {
    return this.activeTab;
  }

  /** Returns the current document content for a given path, or null if not open. */
  getDocContent(path: string): string | null {
    const state = this.states.get(path);
    return state ? state.doc.toString() : null;
  }

  /**
   * Handles external file changes. Applies a diff-based transaction with
   * isRemote so the sync extension skips re-syncing.
   */
  applyRemoteChange(path: string, newContent: string): void {
    if (this.activeTab === path && this.view) {
      // Use the view's live state — it advances on every keystroke/linter update
      // and will reject transactions built from a stale stored state.
      const viewContent = this.view.state.doc.toString();
      const viewDelta = diff(viewContent, newContent);
      if (viewDelta) {
        this.view.dispatch({
          changes: {
            from: viewDelta.from,
            to: viewDelta.to,
            insert: viewDelta.insert,
          },
          annotations: isRemote.of(true),
        });
      }
      return;
    }

    const state = this.states.get(path);
    if (!state) return;

    const oldContent = state.doc.toString();
    const delta = diff(oldContent, newContent);
    if (delta === null) return;

    const tx = state.update({
      changes: { from: delta.from, to: delta.to, insert: delta.insert },
      annotations: isRemote.of(true),
    });
    this.states.set(path, tx.state);
  }

  /**
   * Called when FileStore signals a new file. Adds path to tabs without switching.
   */
  handleFileCreated(path: string): void {
    if (!this.openTabs.includes(path)) {
      this.openTabs.push(path);
      this.onTabsChange([...this.openTabs], this.activeTab);
    }
  }

  /**
   * Called when FileStore signals a file was deleted. Closes tab and syncs delete.
   */

  handleFileDeleted(path: string): void {
    void this.workerClient.deleteFile(path);
    this.closeFile(path);
  }

  /**
   * Subscribes to FileStore events. Returns unsubscribe. Sets up change,
   * created, and deleted handlers.
   */
  subscribe(): () => void {
    const unsubChange = this.fileStore.onFileChange((path, content) => {
      this.applyRemoteChange(path, content);
      void this.workerClient.syncFile(path, content);
    });
    const unsubCreated = this.fileStore.onFileCreated((path) => {
      this.handleFileCreated(path);
    });
    const unsubDeleted = this.fileStore.onFileDeleted((path) => {
      this.handleFileDeleted(path);
    });
    this.unsubscribers.push(unsubChange, unsubCreated, unsubDeleted);
    return () => {
      unsubChange();
      unsubCreated();
      unsubDeleted();
    };
  }

  private buildExtensions(path: string): Extension[] {
    const extensions: Extension[] = [
      javascript({ typescript: true }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      ...tsExtensions(
        this.workerClient,
        path,
        (targetPath, targetOffset) => {
          this.onNavigate(targetPath, targetOffset);
        },
        this.onReferences,
      ),
    ];

    if (this.readOnly) {
      // Prevent all user edits in view-only mode
      extensions.push(
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      );
    } else {
      extensions.push(
        this.fileStoreSyncExtension(path),
        this.contentChangeExtension(),
      );
    }

    return extensions;
  }

  /**
   * Extension that notifies the parent when document content changes locally.
   * Remote changes (from Jazz sync) are excluded to avoid feedback loops.
   */
  private contentChangeExtension(): Extension {
    const onContentChange = this.onContentChange;
    if (!onContentChange) return [];
    return ViewPlugin.fromClass(
      class {
        update(update: import("@codemirror/view").ViewUpdate) {
          if (!update.docChanged) return;
          if (
            update.transactions.some((tr) => tr.annotation(isRemote) === true)
          )
            return;
          onContentChange();
        }
      },
    );
  }

  /**
   * Debounced write-back to the FileStore so edits persist across reloads.
   * Skips remote changes to avoid write-back loops.
   */
  private fileStoreSyncExtension(path: string): Extension {
    const fileStore = this.fileStore;
    return ViewPlugin.fromClass(
      class {
        private timeoutId: ReturnType<typeof setTimeout> | null = null;
        constructor(public view: EditorView) {}

        update(update: import("@codemirror/view").ViewUpdate) {
          if (!update.docChanged) return;
          if (
            update.transactions.some((tr) => tr.annotation(isRemote) === true)
          )
            return;

          if (this.timeoutId != null) clearTimeout(this.timeoutId);
          this.timeoutId = setTimeout(() => {
            this.timeoutId = null;
            fileStore.writeFile(path, this.view.state.doc.toString());
          }, 300);
        }

        destroy() {
          if (this.timeoutId != null) clearTimeout(this.timeoutId);
        }
      },
    );
  }

  /** Cleans up all subscriptions and clears state maps. */
  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.states.clear();
    this.scrollPositions.clear();
    this.openTabs = [];
    this.activeTab = null;
  }
}
