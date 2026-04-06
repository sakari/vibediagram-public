/**
 * @public
 * Props for the TabBar component.
 */
export interface TabBarProps {
  /** Open tab paths. */
  tabs: string[];
  /** Currently active tab path, or null if none. */
  activeTab: string | null;
  /** Called when a tab is selected. */
  onSelect: (path: string) => void;
  /** Called when a tab's close button is clicked. */
  onClose: (path: string) => void;
}

/**
 * Returns the basename (last path segment) for display in a tab.
 */
function basename(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Horizontal tab bar showing open files. Each tab displays the basename
 * with a close button. Active tab is visually highlighted.
 */
export function TabBar({ tabs, activeTab, onSelect, onClose }: TabBarProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        borderBottom: "1px solid #ccc",
        backgroundColor: "#f5f5f5",
      }}
    >
      {tabs.map((path) => {
        const isActive = path === activeTab;
        return (
          <div
            key={path}
            role="tab"
            title={path}
            tabIndex={0}
            onClick={() => {
              onSelect(path);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(path);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              cursor: "pointer",
              borderRight: "1px solid #ccc",
              backgroundColor: isActive ? "#fff" : "transparent",
              fontWeight: isActive ? "bold" : "normal",
              borderBottom: isActive
                ? "2px solid #0066cc"
                : "2px solid transparent",
              marginBottom: isActive ? "-1px" : 0,
            }}
          >
            <span>{basename(path)}</span>
            <button
              type="button"
              aria-label={`Close ${basename(path)}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(path);
              }}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: "0 4px",
                fontSize: "14px",
                lineHeight: 1,
                color: "#666",
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
