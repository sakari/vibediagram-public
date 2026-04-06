import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hotkeysCoreFeature,
  renamingFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { FileStore } from "../store/types.js";
import { buildTreeData } from "./paths-to-tree.js";
import type { TreeNodeData } from "./paths-to-tree.js";

export interface FileTreePanelProps {
  fileStore: FileStore;
  onSelect: (path: string) => void;
  activeFile: string | null;
  theme?: "light" | "dark";
  /** External read-only files (e.g. .d.ts ambient types) shown in the tree but not editable. */
  readOnlyFiles?: { path: string; content: string }[];
  /** When true, all file creation, rename, and delete actions are hidden. */
  readOnly?: boolean;
}

const themeStyles = {
  light: {
    bg: "#fff",
    text: "#333",
    border: "#ccc",
    hoverBg: "#f5f5f5",
    activeBg: "#e3f2fd",
    actionsColor: "#666",
  },
  dark: {
    bg: "#1e1e1e",
    text: "#d4d4d4",
    border: "#444",
    hoverBg: "#2d2d2d",
    activeBg: "#264f78",
    actionsColor: "#888",
  },
};

function getAllPathsUnder(fileStore: FileStore, dirPath: string): string[] {
  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  return fileStore.listFiles().filter((p) => p.startsWith(prefix));
}

function renameDirectory(
  fileStore: FileStore,
  oldPath: string,
  newPath: string,
): void {
  const prefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
  const newPrefix = newPath.endsWith("/") ? newPath : newPath + "/";
  const files = fileStore.listFiles().filter((p) => p.startsWith(prefix));
  for (const p of files) {
    const relative = p.slice(prefix.length);
    const newFilePath = newPrefix + relative;
    const content = fileStore.readFile(p);
    if (content !== undefined) {
      fileStore.writeFile(newFilePath, content);
      fileStore.deleteFile(p);
    }
  }
}

function deleteDirectory(fileStore: FileStore, dirPath: string): void {
  const files = getAllPathsUnder(fileStore, dirPath);
  for (const p of files) {
    fileStore.deleteFile(p);
  }
}

export function FileTreePanel({
  fileStore,
  onSelect,
  activeFile,
  theme = "light",
  readOnlyFiles,
  readOnly,
}: FileTreePanelProps) {
  const styles = themeStyles[theme];
  const readOnlyPaths = useMemo(
    () => (readOnlyFiles ?? []).map((f) => f.path),
    [readOnlyFiles],
  );
  const bridgeRef = useRef(
    buildTreeData(fileStore.listFiles(), readOnlyPaths, []),
  );
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<"file" | "folder">("file");
  const [emptyDirs, setEmptyDirs] = useState(new Set<string>());
  const [newFileName, setNewFileName] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const rebuildFromStore = useCallback(() => {
    bridgeRef.current = buildTreeData(
      fileStore.listFiles(),
      readOnlyPaths,
      Array.from(emptyDirs),
    );
  }, [fileStore, readOnlyPaths, emptyDirs]);

  const tree = useTree<TreeNodeData>({
    rootItemId: "/",
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isFolder,
    dataLoader: {
      getItem: (id) => bridgeRef.current.getItem(id),
      getChildren: (id) => bridgeRef.current.getChildren(id),
    },
    canRename: (item) => !readOnly && !item.getItemData().readOnly,
    onRename: (item, value) => {
      const data = item.getItemData();
      const oldPath = data.path;
      const segments = oldPath.split("/").filter(Boolean);
      segments[segments.length - 1] = value;
      const newPath = "/" + segments.join("/");

      if (data.isFolder) {
        renameDirectory(fileStore, oldPath, newPath);
      } else {
        const content = fileStore.readFile(oldPath) ?? "";
        fileStore.writeFile(newPath, content);
        fileStore.deleteFile(oldPath);
      }
    },
    hotkeys: {
      customOpenFile: {
        hotkey: "Enter",
        handler: (_e, treeInstance) => {
          if (treeInstance.getState().renamingItem) {
            treeInstance.completeRenaming();
            return;
          }
          const focused = treeInstance.getFocusedItem();

          if (!focused.isFolder()) {
            onSelect(focused.getId());
          }
        },
      },
      customDelete: {
        hotkey: "Delete",
        handler: (_e, treeInstance) => {
          if (readOnly) return;
          const focused = treeInstance.getFocusedItem();
          const data = focused.getItemData();
          // Do not allow deleting read-only nodes.
          if (data.readOnly) return;
          if (data.isFolder) {
            deleteDirectory(fileStore, data.path);
          } else {
            fileStore.deleteFile(data.path);
          }
        },
      },
    },
    features: [
      syncDataLoaderFeature,
      hotkeysCoreFeature,
      renamingFeature,
      selectionFeature,
    ],
  });

  useEffect(() => {
    // Rebuild immediately so changes to emptyDirs (or readOnlyPaths) are
    // reflected without waiting for a file-store event.
    rebuildFromStore();
    tree.rebuildTree();

    const rebuild = () => {
      rebuildFromStore();
      tree.rebuildTree();
    };
    // Also listen for file changes — Jazz may load file entries
    // asynchronously after mount, so the tree needs to update when
    // previously-unknown paths become available.
    const unsubChange = fileStore.onFileChange(rebuild);
    const unsubCreated = fileStore.onFileCreated(rebuild);
    const unsubDeleted = fileStore.onFileDeleted(rebuild);
    return () => {
      unsubChange();
      unsubCreated();
      unsubDeleted();
    };
  }, [fileStore, rebuildFromStore, tree]);

  const handleCreateSubmit = (folderPath: string) => {
    const trimmed = newFileName.trim();
    if (trimmed) {
      const newPath = folderPath.endsWith("/")
        ? folderPath + trimmed
        : folderPath + "/" + trimmed;

      if (creatingType === "folder") {
        // Track the folder so it appears in the tree even without files.
        setEmptyDirs((prev) => {
          const next = new Set(prev);
          next.add(newPath);
          return next;
        });
      } else {
        fileStore.writeFile(newPath, "");
        // Clean up emptyDirs that are now covered by real files.
        setEmptyDirs((prev) => {
          const next = new Set(prev);
          for (const dir of prev) {
            if (newPath.startsWith(dir + "/")) {
              next.delete(dir);
            }
          }
          return next;
        });
      }
    }
    setCreatingIn(null);
    setNewFileName("");
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent, folderPath: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateSubmit(folderPath);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCreatingIn(null);
      setNewFileName("");
    }
  };

  const containerProps = tree.getContainerProps();
  const items = tree.getItems();

  return (
    <div
      {...containerProps}
      style={{
        padding: "8px 0",
        backgroundColor: styles.bg,
        color: styles.text,
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "2px 8px",
          gap: 4,
          borderBottom: `1px solid ${styles.border}`,
        }}
      >
        {!readOnly && (
          <button
            type="button"
            aria-label="New file at root"
            title="New File"
            onClick={() => {
              setCreatingIn("/");
              setCreatingType("file");
              setNewFileName("");
            }}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: "2px 6px",
              fontSize: 14,
              color: styles.actionsColor,
            }}
          >
            +
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            aria-label="New folder at root"
            title="New Folder"
            onClick={() => {
              setCreatingIn("/");
              setCreatingType("folder");
              setNewFileName("");
            }}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: "2px 6px",
              fontSize: 14,
              color: styles.actionsColor,
            }}
          >
            &#128193;
          </button>
        )}
        <button
          type="button"
          aria-label="Reveal active file"
          title="Reveal active file in tree"
          disabled={!activeFile}
          onClick={() => {
            if (!activeFile) return;
            const segments = activeFile.split("/").filter(Boolean);
            // Expand all ancestor folders so the active file becomes visible.
            for (let i = 1; i < segments.length; i++) {
              const ancestorPath = "/" + segments.slice(0, i).join("/");
              try {
                const item = tree.getItemInstance(ancestorPath);
                if (!item.isExpanded()) {
                  item.expand();
                }
              } catch {
                // ancestor not in tree
              }
            }
            // Focus the active file item.
            try {
              tree.getItemInstance(activeFile).setFocused();
            } catch {
              // item not in tree
            }
          }}
          style={{
            border: "none",
            background: "none",
            cursor: activeFile ? "pointer" : "default",
            padding: "2px 6px",
            fontSize: 14,
            color: activeFile ? styles.actionsColor : styles.border,
            opacity: activeFile ? 1 : 0.5,
          }}
        >
          &#9678;
        </button>
      </div>
      {!readOnly && creatingIn === "/" && (
        <div style={{ padding: "2px 8px", display: "flex" }}>
          <input
            value={newFileName}
            onChange={(e) => {
              setNewFileName(e.target.value);
            }}
            onKeyDown={(e) => {
              handleCreateKeyDown(e, "/");
            }}
            onBlur={() => {
              handleCreateSubmit("/");
            }}
            autoFocus
            placeholder={creatingType === "folder" ? "Folder name" : "Filename"}
            style={{
              flex: 1,
              padding: "4px 6px",
              border: `1px solid ${styles.border}`,
              borderRadius: 4,
              backgroundColor: styles.bg,
              color: styles.text,
            }}
          />
        </div>
      )}
      {/* eslint-disable-next-line complexity -- render callback with many UI states */}
      {items.map((item) => {
        if (item.getId() === "/") return null;
        const data = item.getItemData();
        const meta = item.getItemMeta();
        const level = meta.level;
        const indent = level * 16;
        const isActive = !data.isFolder && data.path === activeFile;
        const isReadOnly = data.readOnly === true;
        const isHovered = hoveredId === item.getId();

        return (
          <div key={item.getId()}>
            {item.isRenaming() ? (
              <div
                style={{
                  marginLeft: indent,
                  padding: "2px 8px",
                  display: "flex",
                }}
              >
                <input
                  {...item.getRenameInputProps()}
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    border: `1px solid ${styles.border}`,
                    borderRadius: 4,
                    backgroundColor: styles.bg,
                    color: styles.text,
                  }}
                />
              </div>
            ) : (
              <div
                {...item.getProps()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: indent,
                  paddingRight: 8,
                  paddingTop: 2,
                  paddingBottom: 2,
                  cursor: "default",
                  backgroundColor: isActive
                    ? styles.activeBg
                    : isHovered
                      ? styles.hoverBg
                      : "transparent",
                  border: "none",
                  width: "100%",
                  boxSizing: "border-box",
                  overflow: "hidden",
                  textAlign: "left",
                  font: "inherit",
                  color: "inherit",
                  opacity: isReadOnly ? 0.6 : 1,
                }}
                onMouseEnter={() => {
                  setHoveredId(item.getId());
                }}
                onMouseLeave={() => {
                  setHoveredId(null);
                }}
                onClick={(e) => {
                  const props = item.getProps();
                  (
                    props as { onClick?: (e: React.MouseEvent) => void }
                  ).onClick?.(e);
                  if (!data.isFolder) onSelect(data.path);
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {data.isFolder ? (
                    <span style={{ marginRight: 4 }}>
                      {item.isExpanded() ? "\u25be" : "\u25b8"}
                    </span>
                  ) : null}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {data.name}
                  </span>
                </span>
                {isHovered && !isReadOnly && !readOnly && (
                  <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {data.isFolder && (
                      <>
                        <button
                          type="button"
                          aria-label="New file"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCreatingIn(data.path);
                            setCreatingType("file");
                            setNewFileName("");
                          }}
                          style={{
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            padding: "0 4px",
                            fontSize: 12,
                            color: styles.actionsColor,
                          }}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          aria-label="New folder"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCreatingIn(data.path);
                            setCreatingType("folder");
                            setNewFileName("");
                          }}
                          style={{
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            padding: "0 4px",
                            fontSize: 12,
                            color: styles.actionsColor,
                          }}
                        >
                          &#128193;
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      aria-label="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        tree.getItemInstance(item.getId()).startRenaming();
                      }}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        padding: "0 4px",
                        fontSize: 12,
                        color: styles.actionsColor,
                      }}
                    >
                      &#9998;
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (data.isFolder) {
                          deleteDirectory(fileStore, data.path);
                        } else {
                          fileStore.deleteFile(data.path);
                        }
                      }}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        padding: "0 4px",
                        fontSize: 12,
                        color: styles.actionsColor,
                      }}
                    >
                      &#10005;
                    </button>
                  </span>
                )}
              </div>
            )}
            {!readOnly && creatingIn === data.path && data.isFolder && (
              <div
                style={{
                  marginLeft: indent + 16,
                  padding: "2px 8px",
                  display: "flex",
                }}
              >
                <input
                  value={newFileName}
                  onChange={(e) => {
                    setNewFileName(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    handleCreateKeyDown(e, data.path);
                  }}
                  onBlur={() => {
                    handleCreateSubmit(data.path);
                  }}
                  autoFocus
                  placeholder={
                    creatingType === "folder" ? "Folder name" : "Filename"
                  }
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    border: `1px solid ${styles.border}`,
                    borderRadius: 4,
                    backgroundColor: styles.bg,
                    color: styles.text,
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
