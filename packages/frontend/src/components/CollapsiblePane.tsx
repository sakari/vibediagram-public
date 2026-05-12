import React from "react";

interface CollapsiblePaneProps {
  /** Root CSS class identifying the pane (also gets " collapsed" appended). */
  className: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Which edge the chevron button is mounted on. */
  toggleSide: "left" | "right";
  /** Aria-label + title shown when the pane is currently expanded. */
  collapseLabel: string;
  /** Aria-label + title shown when the pane is currently collapsed. */
  expandLabel: string;
  /** Glyph rendered in the chevron when expanded. */
  expandedIcon: string;
  /** Glyph rendered in the chevron when collapsed. */
  collapsedIcon: string;
  /** Pane content. Only rendered when not collapsed. */
  children?: React.ReactNode;
}

/**
 * Pane wrapper with an edge-mounted collapse/expand chevron. When collapsed
 * the pane shrinks to a 28px rail showing only the chevron; the children
 * remain mounted but hidden via CSS so component state (open editor tabs,
 * scroll position, etc.) survives a collapse/expand round-trip.
 *
 * Avoids aria-hidden on the root: the chevron is the only control that can
 * re-expand the pane, so hiding it from assistive tech in the collapsed
 * state would strand keyboard / screen-reader users. The hidden content
 * subtree gets aria-hidden instead.
 */
export function CollapsiblePane({
  className,
  collapsed,
  onToggle,
  toggleSide,
  collapseLabel,
  expandLabel,
  expandedIcon,
  collapsedIcon,
  children,
}: CollapsiblePaneProps) {
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <div className={`${className}${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className={`pane-edge-toggle pane-edge-toggle-${toggleSide}`}
        onClick={onToggle}
        aria-label={label}
        aria-pressed={collapsed}
        title={label}
      >
        {collapsed ? collapsedIcon : expandedIcon}
      </button>
      <div
        className="collapsible-pane-content"
        aria-hidden={collapsed || undefined}
      >
        {children}
      </div>
    </div>
  );
}
