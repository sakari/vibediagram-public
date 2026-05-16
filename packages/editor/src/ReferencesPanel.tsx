export interface ReferenceItem {
  path: string;
  start: number;
  end: number;
  line: number;
  lineText: string;
}

export interface ReferencesPanelProps {
  references: ReferenceItem[];
  currentFile: string | null;
  onSelect: (ref: ReferenceItem) => void;
  onClose: () => void;
}

function basename(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

interface GroupedRefs {
  path: string;
  refs: ReferenceItem[];
}

function groupByFile(references: ReferenceItem[]): GroupedRefs[] {
  const map = new Map<string, ReferenceItem[]>();
  for (const ref of references) {
    let list = map.get(ref.path);
    if (!list) {
      list = [];
      map.set(ref.path, list);
    }
    list.push(ref);
  }
  return Array.from(map.entries()).map(([path, refs]) => ({ path, refs }));
}

export function ReferencesPanel({
  references,
  currentFile,
  onSelect,
  onClose,
}: ReferencesPanelProps) {
  const groups = groupByFile(references);

  return (
    <div
      style={{
        borderTop: "1px solid #444",
        backgroundColor: "#1e1e1e",
        color: "#d4d4d4",
        fontSize: "13px",
        fontFamily: "monospace",
        maxHeight: "200px",
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 8px",
          backgroundColor: "#252526",
          borderBottom: "1px solid #444",
          position: "sticky",
          top: 0,
        }}
      >
        <span style={{ fontWeight: "bold" }}>
          References ({references.length})
        </span>
        <button
          type="button"
          aria-label="Close references panel"
          title="Close the references panel"
          onClick={onClose}
          style={{
            border: "none",
            background: "none",
            color: "#d4d4d4",
            cursor: "pointer",
            fontSize: "14px",
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>
      {groups.map((group) => (
        <div key={group.path}>
          <div
            style={{
              padding: "2px 8px",
              backgroundColor: "#2d2d2d",
              fontWeight: group.path === currentFile ? "bold" : "normal",
              color: "#569cd6",
            }}
          >
            {basename(group.path)}
            <span
              style={{ color: "#888", marginLeft: "8px", fontSize: "12px" }}
            >
              {group.path}
            </span>
          </div>
          {group.refs.map((ref, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelect(ref);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(ref);
                }
              }}
              style={{
                padding: "2px 8px 2px 24px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#2d2d2d";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span style={{ color: "#888", marginRight: "8px" }}>
                {ref.line}
              </span>
              <span>{ref.lineText.trim()}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
