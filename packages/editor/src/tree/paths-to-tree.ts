export type TreeNodeData = {
  name: string;
  path: string;
  isFolder: boolean;
  /** When true the file is provided externally and must not be renamed or deleted. */
  readOnly?: boolean;
};

type TreeDataBridge = {
  getItem(itemId: string): TreeNodeData;
  getChildren(itemId: string): string[];
  rootItemId: string;
};

/** Ensure folder nodes exist for each path in emptyDirs, creating intermediates as needed. */
function insertEmptyDirs(
  emptyDirs: string[],
  rootId: string,
  nodes: Map<string, TreeNodeData>,
  childrenMap: Map<string, string[]>,
): void {
  for (const dirPath of emptyDirs) {
    const segments = dirPath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    for (let i = 0; i < segments.length; i++) {
      const nodePath = "/" + segments.slice(0, i + 1).join("/");
      const parentPath =
        i === 0 ? rootId : "/" + segments.slice(0, i).join("/");

      if (!nodes.has(nodePath)) {
        nodes.set(nodePath, {
          name: segments[i],
          path: nodePath,
          isFolder: true,
        });
      }

      const siblings = childrenMap.get(parentPath) ?? [];
      if (!siblings.includes(nodePath)) {
        siblings.push(nodePath);
        childrenMap.set(parentPath, siblings);
      }
    }
  }
}

/**
 * Build a tree structure from a flat list of file paths.
 *
 * @param paths       - editable file paths (readOnly defaults to undefined)
 * @param readOnlyPaths - optional extra paths merged with `readOnly: true` on leaf nodes
 * @param emptyDirs   - directory paths that should appear as folders even without files underneath
 */
export function buildTreeData(
  paths: string[],
  readOnlyPaths: string[] = [],
  emptyDirs: string[] = [],
): TreeDataBridge {
  const nodes = new Map<string, TreeNodeData>();
  const childrenMap = new Map<string, string[]>();
  const rootId = "/";

  nodes.set(rootId, { name: "", path: rootId, isFolder: true });

  // Collect all read-only leaf paths for quick lookup.
  const readOnlyLeaves = new Set(readOnlyPaths);

  const allPaths = [...paths, ...readOnlyPaths];

  for (const path of allPaths) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    for (let i = 0; i < segments.length; i++) {
      const isLast = i === segments.length - 1;
      const nodePath = "/" + segments.slice(0, i + 1).join("/");
      const parentPath =
        i === 0 ? rootId : "/" + segments.slice(0, i).join("/");

      if (!nodes.has(nodePath)) {
        const name = segments[i];
        const isFolder = !isLast;
        const node: TreeNodeData = { name, path: nodePath, isFolder };
        // Mark leaf nodes from readOnlyPaths as readOnly.
        if (isLast && readOnlyLeaves.has(path)) {
          node.readOnly = true;
        }
        nodes.set(nodePath, node);
      }

      const siblings = childrenMap.get(parentPath) ?? [];
      if (!siblings.includes(nodePath)) {
        siblings.push(nodePath);
        childrenMap.set(parentPath, siblings);
      }
    }
  }

  // Add empty directory nodes so they appear in the tree even without files.
  insertEmptyDirs(emptyDirs, rootId, nodes, childrenMap);

  function getItem(itemId: string): TreeNodeData {
    const node = nodes.get(itemId);
    if (!node) throw new Error(`Unknown item: ${itemId}`);
    return node;
  }

  function getChildren(itemId: string): string[] {
    const childIds = childrenMap.get(itemId) ?? [];
    const items = childIds.map((id) => ({ id, ...getItem(id) }));
    const dirs = items
      .filter((x) => x.isFolder)
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = items
      .filter((x) => !x.isFolder)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs.map((x) => x.id), ...files.map((x) => x.id)];
  }

  return {
    getItem,
    getChildren,
    rootItemId: rootId,
  };
}
