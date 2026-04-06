import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeStyle, InlineEntry, NodeShape } from "./types";
import { isNodeStyle } from "./node-style";
import { isSvgShape, renderShape } from "./shapes";

function isInlineEntries(value: unknown): value is InlineEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) => typeof v === "object" && v !== null && "id" in v && "label" in v,
    )
  );
}

/** Render the list of collapsed inline child rows. */
function InlineChildrenList({
  children,
}: {
  readonly children: readonly InlineEntry[];
}) {
  return (
    <div
      style={{
        borderTop: "1px solid #4a4a6a",
        marginTop: 4,
        paddingTop: 4,
        fontSize: 11,
        color: "#9090a0",
      }}
    >
      {children.map((child) => (
        <div
          key={child.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{child.label}</span>
          {child.value && (
            <span
              style={{
                color: "#e0e0e0",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {child.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Build the base CSS for the node container, merging style overrides. */
function buildNodeCss(
  shape: NodeShape | undefined,
  cssStyleProps: Omit<NodeStyle, "shape">,
  useSvg: boolean,
): React.CSSProperties {
  const css: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: shape === "rounded-rectangle" ? 16 : 4,
    border: "1px solid #4a4a6a",
    background: "#1e1e2e",
    color: "#e0e0e0",
    fontSize: 13,
    minWidth: 80,
    textAlign: "center" as const,
    ...cssStyleProps,
  };

  if (useSvg) {
    // SVG shape draws its own background and border; make the div transparent.
    css.background = "transparent";
    css.border = "none";
    css.borderRadius = 0;
    css.boxShadow = "none";
    css.position = "relative";
  }

  return css;
}

/** Render the SVG shape background when the node uses a non-rectangular shape. */
function ShapeOverlay({
  shape,
  cssStyleProps,
}: {
  readonly shape: NodeShape;
  readonly cssStyleProps: Omit<NodeStyle, "shape">;
}) {
  return renderShape(
    shape,
    cssStyleProps.background ?? "#1e1e2e",
    cssStyleProps.borderColor ?? "#4a4a6a",
    typeof cssStyleProps.borderWidth === "number"
      ? cssStyleProps.borderWidth
      : 1,
  );
}

/** Render the node label, with optional description tooltip. */
function NodeLabel({
  label,
  description,
}: {
  readonly label: string;
  readonly description: string | undefined;
}) {
  if (description) {
    return (
      <div className="diagram-label-hint" title={description}>
        {label}
      </div>
    );
  }
  return <div>{label}</div>;
}

/**
 * Default node component for the diagram renderer. Renders a labelled
 * box with source/target handles. Applies NodeStyle as inline CSS.
 */
export function DefaultNode({ data }: NodeProps) {
  const nodeStyle: NodeStyle | undefined = isNodeStyle(data.nodeStyle)
    ? data.nodeStyle
    : undefined;

  const shape: NodeShape | undefined = nodeStyle?.shape;
  // Separate shape from CSS-passthrough props so it doesn't leak into inline styles.
  const { shape: _shape, ...cssStyleProps } = nodeStyle ?? {};

  const inlineChildren: InlineEntry[] | undefined = isInlineEntries(
    data.inlineChildren,
  )
    ? data.inlineChildren
    : undefined;

  const description =
    typeof data.description === "string" && data.description.length > 0
      ? data.description
      : undefined;

  const useSvg = isSvgShape(shape);
  const css = buildNodeCss(shape, cssStyleProps, useSvg);
  const label = typeof data.label === "string" ? data.label : "";

  return (
    <div style={css}>
      <Handle type="target" position={Position.Top} />
      {useSvg && shape != null && (
        <ShapeOverlay shape={shape} cssStyleProps={cssStyleProps} />
      )}
      <div style={useSvg ? { position: "relative", zIndex: 1 } : undefined}>
        <NodeLabel label={label} description={description} />
        {inlineChildren && inlineChildren.length > 0 && (
          <InlineChildrenList>{inlineChildren}</InlineChildrenList>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
