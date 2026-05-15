import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeStyle } from "./types";
import { isNodeStyle } from "./node-style";

/**
 * Custom group node component for the diagram renderer. Renders a
 * labelled container that acts as a parent for child nodes. React Flow
 * positions children absolutely inside the group; this component
 * provides the visual frame, header label, and hidden connection handles.
 */
export function GroupNode({ data, width, height }: NodeProps) {
  const nodeStyle: NodeStyle | undefined = isNodeStyle(data.nodeStyle)
    ? data.nodeStyle
    : undefined;

  const css: React.CSSProperties = {
    boxSizing: "border-box",
    width: width ?? "100%",
    height: height ?? "100%",
    borderRadius: 6,
    border: "1px solid var(--group-border, #5a5a7a)",
    background: "var(--group-bg, rgba(30, 30, 46, 0.5))",
    position: "relative",
    ...nodeStyle,
  };

  return (
    <div style={css} data-testid="group-container">
      <Handle
        type="target"
        position={Position.Top}
        style={{ visibility: "hidden" }}
      />
      <div
        style={{
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--group-header-text, #b0b0c0)",
          borderBottom: "1px solid var(--group-border, #5a5a7a)",
          background: "var(--group-header-bg, rgba(40, 40, 56, 0.7))",
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
        }}
      >
        {typeof data.description === "string" && data.description.length > 0 ? (
          <span className="diagram-label-hint" title={data.description}>
            {typeof data.label === "string" ? data.label : ""}
          </span>
        ) : (
          <span>{typeof data.label === "string" ? data.label : ""}</span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ visibility: "hidden" }}
      />
    </div>
  );
}
